import { triage } from './triage';
export interface Ticket {
	id: string;
	team: string;
	channel: string;
	requester: string;
	source_key: string;
	text: string;
	category: string;
	route: string;
	priority: 'normal' | 'high';
	status: 'open' | 'in_progress' | 'escalated' | 'resolved';
	assignee: string | null;
	thread_ts: string | null;
	version: number;
	created_at: string;
	updated_at: string;
}
export interface Intake {
	team: string;
	channel: string;
	requester: string;
	sourceKey: string;
	text: string;
	priority: 'normal' | 'high';
	threadTs?: string;
}
export async function createTicket(db: D1Database, input: Intake): Promise<Ticket> {
	const result = triage(input.text);
	const id = `CH-${crypto.randomUUID()}`;
	await db
		.prepare(
			`INSERT INTO tickets(id,team,channel,requester,source_key,text,category,route,priority,last_actor,thread_ts)
    VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(team,source_key) DO NOTHING`,
		)
		.bind(
			id,
			input.team,
			input.channel,
			input.requester,
			input.sourceKey,
			input.text.slice(0, 2000),
			result.category,
			result.route,
			input.priority,
			input.requester,
			input.threadTs ?? null,
		)
		.run();
	const ticket = await db.prepare('SELECT * FROM tickets WHERE team=? AND source_key=?').bind(input.team, input.sourceKey).first<Ticket>();
	if (!ticket) throw new Error('ticket_write_failed');
	return ticket;
}
export function getTicket(db: D1Database, team: string, channel: string, id: string) {
	return db.prepare('SELECT * FROM tickets WHERE team=? AND channel=? AND id=?').bind(team, channel, id).first<Ticket>();
}
export async function transitionTicket(
	db: D1Database,
	ticket: Ticket,
	actor: string,
	action: 'claim' | 'escalate' | 'resolve',
	version: number,
	support: boolean,
) {
	if (!support && (actor !== ticket.requester || action === 'claim')) return null;
	const status = action === 'claim' ? 'in_progress' : action === 'escalate' ? 'escalated' : 'resolved';
	const result = await db
		.prepare(
			`UPDATE tickets SET status=?, assignee=CASE WHEN ?='claim' THEN ? ELSE assignee END,
    version=version+1, last_actor=?, last_action=?, updated_at=CURRENT_TIMESTAMP
    WHERE id=? AND team=? AND channel=? AND version=? AND status!='resolved'
    AND (?!='claim' OR status IN ('open','escalated')) RETURNING *`,
		)
		.bind(status, action, actor, actor, action, ticket.id, ticket.team, ticket.channel, version, action)
		.first<Ticket>();
	return result;
}
export async function history(db: D1Database, ticket: Ticket) {
	const result = await db
		.prepare('SELECT actor,action,status,version,at FROM ticket_history WHERE ticket_id=? ORDER BY sequence DESC LIMIT 20')
		.bind(ticket.id)
		.all<{ actor: string; action: string; status: string; version: number; at: string }>();
	return result.results.reverse();
}
export async function listTickets(db: D1Database, team: string, channel: string, requester: string) {
	return (
		await db
			.prepare('SELECT * FROM tickets WHERE team=? AND channel=? AND requester=? ORDER BY created_at DESC,id LIMIT 10')
			.bind(team, channel, requester)
			.all<Ticket>()
	).results;
}

export async function queueTickets(db: D1Database, team: string, channel: string) {
	return (
		await db
			.prepare(
				"SELECT * FROM tickets WHERE team=? AND channel=? AND status!='resolved' ORDER BY CASE priority WHEN 'high' THEN 0 ELSE 1 END,created_at,id LIMIT 10",
			)
			.bind(team, channel)
			.all<Ticket>()
	).results;
}
