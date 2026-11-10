import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import schema from '../migrations/0001_tickets.sql?raw';
import { createTicket, getTicket, transitionTicket, history } from '../src/tickets';
const db = (env as unknown as { DB: D1Database }).DB;
const input = {
	team: 'T1',
	channel: 'C1',
	requester: 'U1',
	sourceKey: 'event-1',
	text: 'Atlas AI API returns 429',
	priority: 'normal' as const,
};
beforeEach(async () => {
	await db.exec(schema);
	await db.exec('DELETE FROM ticket_history; DELETE FROM tickets;');
});
describe('persistent support workflow', () => {
	it('creates once for redelivery, retaining classification and audit', async () => {
		const a = await createTicket(db, input);
		const b = await createTicket(db, input);
		expect(b.id).toBe(a.id);
		expect(a.category).toBe('integration');
		expect(a.route).toBe('Integration Engineering');
		expect(a.status).toBe('open');
		expect(await history(db, a)).toHaveLength(1);
		expect(await getTicket(db, 'T2', 'C1', a.id)).toBeNull();
		expect(await getTicket(db, 'T1', 'C2', a.id)).toBeNull();
	});
	it('enforces role, version and terminal status across claim, escalation and resolution', async () => {
		const t = await createTicket(db, input);
		const change = (actor: string, action: 'claim' | 'escalate' | 'resolve', version: number, support = false) =>
			transitionTicket(db, t, actor, action, version, support);
		expect(await change('U2', 'claim', 0)).toBeNull();
		expect(await change('U2', 'resolve', 0)).toBeNull();
		const claimed = await change('USUPPORT', 'claim', 0, true);
		expect(claimed?.assignee).toBe('USUPPORT');
		expect(claimed?.status).toBe('in_progress');
		expect(await change('U1', 'resolve', 0)).toBeNull(); // stale
		const escalated = await change('U1', 'escalate', 1);
		expect(escalated?.status).toBe('escalated');
		const resolved = await change('USUPPORT', 'resolve', 2, true);
		expect(resolved?.status).toBe('resolved');
		expect(await change('U1', 'escalate', 3)).toBeNull();
		expect((await history(db, t)).map((row) => row.action)).toEqual(['created', 'claim', 'escalate', 'resolve']);
	});
	it('allows only one concurrent state transition for a version', async () => {
		const t = await createTicket(db, input);
		const results = await Promise.all([transitionTicket(db, t, 'S1', 'claim', 0, true), transitionTicket(db, t, 'S2', 'claim', 0, true)]);
		expect(results.filter(Boolean)).toHaveLength(1);
		expect(await history(db, t)).toHaveLength(2);
	});
	it('deduplicates concurrently and isolates equal source keys between teams', async () => {
		const tickets = await Promise.all([createTicket(db, input), createTicket(db, input)]);
		expect(tickets[0].id).toBe(tickets[1].id);
		const other = await createTicket(db, { ...input, team: 'T2' });
		expect(other.id).not.toBe(tickets[0].id);
	});
});
