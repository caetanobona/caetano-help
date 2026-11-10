import type { KnownBlock } from '@slack/types';
import { verifySlackRequest } from './signature';
import { createTicket, getTicket, history, listTickets, queueTickets, transitionTicket, type Ticket } from './tickets';
import { slackApi } from './slack-api';
import { helpText, intakeModal, ticketCard } from './slack-ui';
export interface SupportEnv {
	SLACK_SIGNING_SECRET: string;
	SLACK_BOT_TOKEN: string;
	DB?: D1Database;
	SUPPORT_USER_IDS?: string;
	SLACK_TEAM_ID?: string;
}
const json = (data: unknown, status = 200) => Response.json(data, { status });
const privateReply = (text: string) => json({ response_type: 'ephemeral', text });
const object = (x: unknown): Record<string, any> | null =>
	x !== null && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, any>) : null;
const id = (x: unknown): x is string => typeof x === 'string' && /^[A-Z0-9_-]{1,100}$/.test(x);
function supportUser(env: SupportEnv, user: string) {
	return (env.SUPPORT_USER_IDS ?? '')
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean)
		.includes(user);
}
function notify(env: SupportEnv, channel: string, user: string, text: string, blocks?: KnownBlock[]) {
	return slackApi(env.SLACK_BOT_TOKEN, 'chat.postEphemeral', {
		channel,
		user,
		text,
		...(blocks ? { blocks } : {}),
		parse: 'none',
		mrkdwn: false,
		unfurl_links: false,
		unfurl_media: false,
	});
}
async function publish(env: SupportEnv, ticket: Ticket, key: string) {
	const db = env.DB!;
	const reserved = await db
		.prepare('INSERT INTO deliveries(team,source_key) VALUES(?,?) ON CONFLICT DO NOTHING RETURNING source_key')
		.bind(ticket.team, key)
		.first();
	if (!reserved) return;
	const result = await slackApi(env.SLACK_BOT_TOKEN, 'chat.postMessage', {
		channel: ticket.channel,
		...(ticket.thread_ts ? { thread_ts: ticket.thread_ts } : {}),
		...ticketCard(ticket),
	});
	if (result && !ticket.thread_ts && typeof result.ts === 'string')
		await db.prepare('UPDATE tickets SET thread_ts=? WHERE id=? AND thread_ts IS NULL').bind(result.ts, ticket.id).run();
	await db
		.prepare('UPDATE deliveries SET state=? WHERE team=? AND source_key=?')
		.bind(result ? 'sent' : 'failed', ticket.team, key)
		.run();
}
function background(ctx: ExecutionContext, work: () => Promise<unknown>, env: SupportEnv, channel: string, user: string) {
	ctx.waitUntil(
		work().catch(async () => {
			console.error('Support workflow failed', { code: 'workflow_error' });
			await notify(
				env,
				channel,
				user,
				'The request could not be completed. Check status before resubmitting; no automatic retry was made.',
			);
		}),
	);
}
export async function handleSupport(request: Request, env: SupportEnv, ctx: ExecutionContext): Promise<Response> {
	if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'POST' } });
	if (!env.SLACK_SIGNING_SECRET || !env.SLACK_BOT_TOKEN) return new Response('Worker configuration error', { status: 500 });
	const raw = new TextDecoder().decode(await request.arrayBuffer());
	if (raw.length > 65000) return new Response('Payload too large', { status: 413 });
	if (!(await verifySlackRequest(request, raw, env.SLACK_SIGNING_SECRET))) return new Response('Invalid Slack signature', { status: 401 });
	if (!request.headers.get('Content-Type')?.startsWith('application/x-www-form-urlencoded'))
		return new Response('Unsupported media type', { status: 415 });
	const form = new URLSearchParams(raw);
	if (new URL(request.url).pathname === '/slack/commands') {
		const team = form.get('team_id'),
			channel = form.get('channel_id'),
			user = form.get('user_id');
		if (form.get('command') !== '/caetano' || !id(team) || !id(channel) || !id(user))
			return new Response('Invalid command', { status: 400 });
		if (!env.SLACK_TEAM_ID || env.SLACK_TEAM_ID !== team) return new Response('Workspace not configured or authorized', { status: 403 });
		const text = (form.get('text') ?? '').trim();
		if (!text || text === 'help') return privateReply(helpText);
		if (!env.DB) return privateReply('Ticket storage is not configured. Ask the app owner to configure local D1.');
		if (text === 'new') {
			const trigger = form.get('trigger_id');
			if (!trigger) return new Response('Missing trigger', { status: 400 });
			background(
				ctx,
				async () => {
					const result = await slackApi(env.SLACK_BOT_TOKEN, 'views.open', {
						trigger_id: trigger,
						view: intakeModal({ team, channel, requester: user }),
					});
					if (!result) await notify(env, channel, user, 'The form could not open. Run /caetano new again.');
				},
				env,
				channel,
				user,
			);
			return new Response('');
		}
		if (text === 'list' || text === 'queue' || text.startsWith('status ')) {
			background(
				ctx,
				async () => {
					let result: string;
					let blocks: KnownBlock[] | undefined;
					if (text === 'queue') {
						if (!supportUser(env, user)) result = 'Support role required for the channel queue.';
						else {
							const tickets = await queueTickets(env.DB!, team, channel);
							result = tickets.length
								? tickets.map((t) => `${t.id} · ${t.status} · ${t.priority} · ${t.assignee ?? 'unassigned'}`).join('\n')
								: 'No open requests in this channel.';
						}
					} else if (text === 'list') {
						const tickets = await listTickets(env.DB!, team, channel, user);
						result = tickets.length
							? tickets.map((t) => `${t.id} · ${t.status} · ${t.priority}`).join('\n')
							: 'No requests found for you in this channel.';
					} else {
						const ticket = await getTicket(env.DB!, team, channel, text.slice(7).trim());
						if (!ticket || (!supportUser(env, user) && ticket.requester !== user))
							result = 'Request unavailable in this channel or not authorized.';
						else {
							const card = ticketCard(ticket);
							const audit =
								'History: (last 20 events)\n' +
								(await history(env.DB!, ticket)).map((h) => `${h.at} · ${h.action} · ${h.actor}`).join('\n');
							blocks = [...card.blocks, { type: 'section', text: { type: 'plain_text', text: audit.slice(0, 2800) } }];
							result = `${card.text}\n${audit}`;
						}
					}
					await notify(env, channel, user, result, blocks);
				},
				env,
				channel,
				user,
			);
			return privateReply('Looking up requests privately…');
		}
		return privateReply(helpText);
	}
	let payload: Record<string, any> | null;
	try {
		payload = object(JSON.parse(form.get('payload') ?? ''));
	} catch {
		return new Response('Invalid interaction', { status: 400 });
	}
	if (!payload) return new Response('Invalid interaction', { status: 400 });
	const team = object(payload.team)?.id,
		user = object(payload.user)?.id;
	if (!id(team) || !id(user) || !env.DB) return new Response('Invalid interaction or storage unavailable', { status: 400 });
	if (!env.SLACK_TEAM_ID || env.SLACK_TEAM_ID !== team) return new Response('Workspace not configured or authorized', { status: 403 });
	if (payload.type === 'view_submission') {
		const view = object(payload.view);
		let metadata: Record<string, any> | null;
		try {
			metadata = object(JSON.parse(view?.private_metadata ?? ''));
		} catch {
			return new Response('Invalid context', { status: 400 });
		}
		if (
			view?.callback_id !== 'support_intake' ||
			!id(view.id) ||
			metadata?.team !== team ||
			metadata?.requester !== user ||
			!id(metadata?.channel)
		)
			return new Response('Invalid context', { status: 400 });
		const values = object(object(view.state)?.values);
		const details = object(object(values?.details)?.value)?.value;
		const priority = object(object(object(values?.priority)?.value)?.selected_option)?.value;
		const errors: Record<string, string> = {};
		if (typeof details !== 'string' || details.trim().length < 10 || details.length > 2000)
			errors.details = 'Describe the tool, issue and expected behavior (10–2000 characters).';
		if (priority !== 'normal' && priority !== 'high') errors.priority = 'Choose normal or high impact.';
		if (Object.keys(errors).length) return json({ response_action: 'errors', errors });
		const channel = metadata.channel;
		background(
			ctx,
			async () => {
				const ticket = await createTicket(env.DB!, {
					team,
					channel,
					requester: user,
					sourceKey: `view:${view.id}`,
					text: details,
					priority,
				});
				await publish(env, ticket, `created:${ticket.source_key}`);
			},
			env,
			channel,
			user,
		);
		return json({ response_action: 'clear' });
	}
	if (payload.type === 'block_actions') {
		const channel = object(payload.channel)?.id;
		const actions = Array.isArray(payload.actions) ? payload.actions : [];
		const action = object(actions[0]);
		if (
			!id(channel) ||
			actions.length !== 1 ||
			!['ticket_claim', 'ticket_escalate', 'ticket_resolve'].includes(action?.action_id) ||
			typeof action?.value !== 'string'
		)
			return new Response('Invalid action', { status: 400 });
		const [ticketId, versionText, ...extra] = action.value.split('|');
		if (!/^CH-[a-f0-9-]{36}$/.test(ticketId) || !/^\d{1,8}$/.test(versionText) || extra.length)
			return new Response('Invalid action value', { status: 400 });
		background(
			ctx,
			async () => {
				const ticket = await getTicket(env.DB!, team, channel, ticketId);
				const updated =
					ticket && (await transitionTicket(env.DB!, ticket, user, action.action_id.slice(7), Number(versionText), supportUser(env, user)));
				if (!updated) {
					await notify(
						env,
						channel,
						user,
						'Action unavailable: unauthorized, already resolved, or stale card. Use /caetano status with the request ID.',
					);
					return;
				}
				await publish(env, updated, `updated:${ticketId}:${updated.version}`);
			},
			env,
			channel,
			user,
		);
		return new Response('');
	}
	return new Response('Unsupported interaction', { status: 400 });
}

export async function intakeFromEvent(
	env: SupportEnv,
	team: string,
	channel: string,
	user: string,
	eventId: string,
	text: string,
	threadTs: string,
) {
	const ticket = await createTicket(env.DB!, {
		team,
		channel,
		requester: user,
		sourceKey: `event:${eventId}`,
		text,
		priority: 'normal',
		threadTs,
	});
	await publish(env, ticket, `created:${ticket.source_key}`);
}
