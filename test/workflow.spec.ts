import { env as bindings, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import worker from '../src/index';
import schema from '../migrations/0001_tickets.sql?raw';
import { getTicket, history } from '../src/tickets';
const db = (bindings as unknown as { DB: D1Database }).DB;
const config = {
	DB: db,
	SLACK_SIGNING_SECRET: 'test-signing-secret',
	SLACK_BOT_TOKEN: 'test-bot-token',
	SUPPORT_USER_IDS: 'USUPPORT',
	SLACK_TEAM_ID: 'T1',
};
async function signed(path: string, fields: Record<string, string>, valid = true, rawBody?: string) {
	const body = rawBody ?? new URLSearchParams(fields).toString();
	const ts = String(Math.floor(Date.now() / 1000));
	const key = await crypto.subtle.importKey(
		'raw',
		new TextEncoder().encode(config.SLACK_SIGNING_SECRET),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign'],
	);
	const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`v0:${ts}:${body}`));
	const signature = 'v0=' + Array.from(new Uint8Array(digest), (x) => x.toString(16).padStart(2, '0')).join('');
	return new Request('https://example.com' + path, {
		method: 'POST',
		body,
		headers: {
			'Content-Type': rawBody ? 'application/json' : 'application/x-www-form-urlencoded',
			'X-Slack-Request-Timestamp': ts,
			'X-Slack-Signature': valid ? signature : 'v0=' + '0'.repeat(64),
		},
	});
}
async function invoke(path: string, fields: Record<string, string>, valid = true) {
	const ctx = createExecutionContext();
	const response = await worker.fetch(await signed(path, fields, valid), config, ctx);
	await waitOnExecutionContext(ctx);
	return response;
}
const command = (text: string) => ({ command: '/caetano-help', text, team_id: 'T1', channel_id: 'C1', user_id: 'U1', trigger_id: 'trigger-1' });
const submission = (text: string) => ({
	type: 'view_submission',
	team: { id: 'T1' },
	user: { id: 'U1' },
	view: {
		id: 'V1',
		callback_id: 'support_intake',
		private_metadata: JSON.stringify({ team: 'T1', channel: 'C1', requester: 'U1' }),
		state: { values: { details: { value: { value: text } }, priority: { value: { selected_option: { value: 'normal' } } } } },
	},
});
let calls: { method: string; body: any }[];
beforeEach(async () => {
	await db.exec(schema);
	await db.exec('DELETE FROM deliveries; DELETE FROM ticket_history; DELETE FROM tickets;');
	calls = [];
	vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
		calls.push({ method: String(url).split('/').pop()!, body: JSON.parse(String(init?.body)) });
		return Response.json({ ok: true, ts: '1700000001.001' });
	});
});
afterEach(() => vi.restoreAllMocks());
it('serves signed help privately and rejects forged requests', async () => {
	const result = await invoke('/slack/commands', command('help'));
	expect(result.status).toBe(200);
	const body = (await result.json()) as any;
	expect(body.response_type).toBe('ephemeral');
	expect(body.text).toContain('/caetano-help new');
	expect((await invoke('/slack/commands', command('help'), false)).status).toBe(401);
	expect(calls).toHaveLength(0);
});
it('opens a modal using the short-lived trigger, not response_url', async () => {
	const result = await invoke('/slack/commands', command('new'));
	expect(result.status).toBe(200);
	expect(calls[0].method).toBe('views.open');
	expect(calls[0].body.trigger_id).toBe('trigger-1');
	expect(calls[0].body.view.callback_id).toBe('support_intake');
	expect(calls[0].body.view.blocks[0].text.text).toContain('posted in this channel');
	expect(calls[0].body.view.blocks.some((b: any) => b.type === 'input')).toBe(true);
});
it('validates modal fields with inline errors before saving', async () => {
	const response = await invoke('/slack/interactions', { payload: JSON.stringify(submission('')) });
	expect(await response.json()).toEqual({
		response_action: 'errors',
		errors: { details: 'Describe the tool, issue and expected behavior (10–2000 characters).' },
	});
	expect(calls).toHaveLength(0);
});
it('creates one ticket from a message shortcut and replies in the original thread', async () => {
	const interact = (payload: object, valid = true) => invoke('/slack/interactions', { payload: JSON.stringify(payload) }, valid);
	const shortcut = {
		type: 'message_action', callback_id: 'create_support_ticket', trigger_id: 'trigger-1',
		team: { id: 'T1' }, user: { id: 'U1' }, channel: { id: 'C1' },
		message: { text: 'Orbit AI API returns 429', ts: '1700000002.000001', thread_ts: '1700000000.000001' },
	};
	expect((await interact(shortcut, false)).status).toBe(401);
	expect((await interact(shortcut)).status).toBe(200);
	const modal = calls[0].body.view;
	expect(calls[0].method).toBe('views.open');
	expect(modal.blocks.find((b: any) => b.block_id === 'details').element.initial_value).toBe(shortcut.message.text);
	expect(calls).toHaveLength(1);
	for (const viewId of ['V1', 'V2']) {
		const submitted = submission(shortcut.message.text);
		submitted.view.id = viewId;
		submitted.view.private_metadata = modal.private_metadata;
		expect((await interact(submitted)).status).toBe(200);
	}
	const posts = calls.filter((call) => call.method === 'chat.postMessage');
	expect(posts).toHaveLength(1);
	expect(posts[0].body.thread_ts).toBe(shortcut.message.thread_ts);
	expect(await db.prepare('SELECT source_key FROM tickets').first()).toEqual({ source_key: 'message:C1:1700000002.000001' });
});
it('lets the requester refine the same ticket once and records the update', async () => {
	const interact = (payload: object) => invoke('/slack/interactions', { payload: JSON.stringify(payload) });
	await interact(submission('I cannot get into the tool.'));
	const card = calls[0].body;
	const button = card.blocks.find((block: any) => block.type === 'actions').elements
		.find((element: any) => element.action_id === 'ticket_details');
	expect(button).toBeDefined();
	const action = {
		type: 'block_actions', trigger_id: 'trigger-1', team: { id: 'T1' }, user: { id: 'U1' },
		channel: { id: 'C1' }, actions: [button],
	};
	await interact({ ...action, user: { id: 'U2' } });
	expect(calls.some((call) => call.method === 'views.open')).toBe(false);
	expect((await interact(action)).status).toBe(200);
	const modal = calls.find((call) => call.method === 'views.open')!.body.view;
	const text = 'I cannot get into the tool. '.padEnd(320, '.') + ' Atlas AI SSO login denied.';
	const submitted = submission(text);
	submitted.view.callback_id = modal.callback_id;
	submitted.view.private_metadata = modal.private_metadata;
	expect((await interact({ ...submitted, user: { id: 'U2' } })).status).toBe(400);
	await Promise.all([interact(submitted), interact(submitted)]);
	const posts = calls.filter((call) => call.method === 'chat.postMessage');
	expect(posts).toHaveLength(2);
	expect(posts[1].body.text).toContain('RB-ACCESS');
	expect(posts[1].body.thread_ts).toBe('1700000001.001');
	const ticket = (await getTicket(db, 'T1', 'C1', button.value.split('|')[0]))!;
	expect(ticket).toMatchObject({ text, category: 'access', status: 'open', version: 1 });
	expect((await history(db, ticket)).map((entry) => entry.action)).toEqual(['created', 'details_added']);
});
it('persists a modal intake once, posts a sourced card, and completes authorized lifecycle', async () => {
	const payload = submission('Orbit AI API returns 429');
	for (let i = 0; i < 2; i++) expect((await invoke('/slack/interactions', { payload: JSON.stringify(payload) })).status).toBe(200);
	const posts = calls.filter((c) => c.method === 'chat.postMessage');
	expect(posts).toHaveLength(1);
	const card = posts[0].body;
	expect(card.blocks[0].text.text).toBe('Support request');
	expect(card.blocks[1].elements[0].text).toContain('*Open*');
	expect(card.blocks[2].text).toMatchObject({ type: 'mrkdwn', text: expect.stringContaining('*Suggested next step*') });
	expect(card.blocks.at(-1).elements[1].text).toContain('RB-INTEGRATION');
	expect(card.text).toContain('RB-INTEGRATION');
	expect(card.blocks.some((b: any) => b.type === 'actions')).toBe(true);
	const id = card.blocks.find((b: any) => b.type === 'actions').elements[0].value.split('|')[0];
	let t = await getTicket(db, 'T1', 'C1', id);
	expect(t?.requester).toBe('U1');
	expect(t?.thread_ts).toBe('1700000001.001');
	const action = async (user: string, name: string, version: number, channel = 'C1') =>
		invoke('/slack/interactions', {
			payload: JSON.stringify({
				type: 'block_actions',
				team: { id: 'T1' },
				user: { id: user },
				channel: { id: channel },
				actions: [{ action_id: name, value: `${id}|${version}` }],
				message: { ts: '1700000001.001' },
			}),
		});
	await action('UOTHER', 'ticket_resolve', 0);
	expect((await getTicket(db, 'T1', 'C1', id))?.status).toBe('open');
	await action('USUPPORT', 'ticket_claim', 0);
	expect((await getTicket(db, 'T1', 'C1', id))?.status).toBe('in_progress');
	await action('U1', 'ticket_escalate', 1);
	expect((await getTicket(db, 'T1', 'C1', id))?.status).toBe('escalated');
	await action('USUPPORT', 'ticket_resolve', 2, 'COTHER');
	expect((await getTicket(db, 'T1', 'C1', id))?.status).toBe('escalated');
	await action('USUPPORT', 'ticket_resolve', 2);
	t = await getTicket(db, 'T1', 'C1', id);
	expect(t?.status).toBe('resolved');
	expect(
		calls
			.filter((c) => c.method === 'chat.postMessage')
			.slice(1)
			.every((c) => c.body.thread_ts === '1700000001.001'),
	).toBe(true);
	expect((await history(db, t!)).map((h) => h.action)).toEqual(['created', 'claim', 'escalate', 'resolve']);
	const status = await invoke('/slack/commands', command(`status ${id}`));
	expect(status.status).toBe(200);
	expect(calls.filter((c) => c.method === 'chat.postEphemeral').at(-1)?.body.text).toContain('Support request · Resolved');
});
it('does not accept tampered modal workspace/requester metadata', async () => {
	const payload = submission('Atlas AI login is denied');
	payload.user.id = 'UOTHER';
	expect((await invoke('/slack/interactions', { payload: JSON.stringify(payload) })).status).toBe(400);
	expect(calls).toHaveLength(0);
});
it('rejects unsupported or malformed interaction payloads without an API call', async () => {
	for (const payload of ['{broken', 'null', '{"type":"block_actions"}']) {
		expect((await invoke('/slack/interactions', { payload })).status).toBe(400);
	}
	expect(calls).toHaveLength(0);
});

it('keeps a persisted ticket accessible when Slack rejects the creation post', async () => {
	const log = vi.spyOn(console, 'error').mockImplementation(() => {});
	vi.mocked(fetch).mockResolvedValue(Response.json({ ok: false, error: 'rate_limited' }));
	await invoke('/slack/interactions', { payload: JSON.stringify(submission('Atlas AI login says denied')) });
	const stored = await db.prepare('SELECT id,status FROM tickets').first<{ id: string; status: string }>();
	expect(stored?.status).toBe('open');
	expect((await db.prepare('SELECT state FROM deliveries').first<{ state: string }>())?.state).toBe('failed');
	expect(JSON.stringify(log.mock.calls)).not.toContain('rate_limited');
});
it.each(['Atlas AI SSO login denied', 'Orbit AI API timeout', 'Can Atlas AI summarize support tickets for a new use case?'])(
	'resolves each portfolio scenario: %s',
	async (text) => {
		await invoke('/slack/interactions', { payload: JSON.stringify(submission(text)) });
		const ticket = await db.prepare('SELECT * FROM tickets').first<any>();
		expect(ticket.category).not.toBe('unknown');
		await invoke('/slack/interactions', {
			payload: JSON.stringify({
				type: 'block_actions',
				team: { id: 'T1' },
				user: { id: 'U1' },
				channel: { id: 'C1' },
				actions: [{ action_id: 'ticket_resolve', value: `${ticket.id}|0` }],
			}),
		});
		expect((await getTicket(db, 'T1', 'C1', ticket.id))?.status).toBe('resolved');
	},
);

it('deduplicates signed mentions with storage and keeps their existing thread', async () => {
	const payload = {
		type: 'event_callback',
		event_id: 'Ev1',
		team_id: 'T1',
		event: {
			type: 'app_mention',
			user: 'U1',
			channel: 'C1',
			ts: '1700000000.001',
			thread_ts: '1699999999.002',
			text: 'Orbit AI API returns 429',
		},
	};
	for (let i = 0; i < 2; i++) {
		const ctx = createExecutionContext();
		expect((await worker.fetch(await signed('/slack/events', {}, true, JSON.stringify(payload)), config, ctx)).status).toBe(200);
		await waitOnExecutionContext(ctx);
	}
	expect(await db.prepare('SELECT COUNT(*) AS n FROM tickets').first('n')).toBe(1);
	expect(calls.filter((c) => c.method === 'chat.postMessage')).toHaveLength(1);
	expect(calls[0].body.thread_ts).toBe('1699999999.002');
});
it('renders a human handoff after manual escalation instead of claiming guidance resolved it', async () => {
	await invoke('/slack/interactions', { payload: JSON.stringify(submission('Orbit AI API returns 429')) });
	const ticket = await db.prepare('SELECT * FROM tickets').first<any>();
	await invoke('/slack/interactions', {
		payload: JSON.stringify({
			type: 'block_actions',
			team: { id: 'T1' },
			user: { id: 'U1' },
			channel: { id: 'C1' },
			actions: [{ action_id: 'ticket_escalate', value: `${ticket.id}|0` }],
		}),
	});
	const post = calls.filter((c) => c.method === 'chat.postMessage').at(-1)!;
	expect(post.body.text).toContain('Human handoff');
	expect(post.body.text).toContain('Missing:');
	expect(post.body.text).toContain('Support Lead');
});
it('shows the support queue only to configured support users in the current channel', async () => {
	await invoke('/slack/interactions', { payload: JSON.stringify(submission('Orbit AI API returns 429')) });
	const ticket = await db.prepare('SELECT id FROM tickets').first<any>();
	await invoke('/slack/commands', command('queue'));
	expect(calls.filter((c) => c.method === 'chat.postEphemeral').at(-1)?.body.text ?? '').not.toContain(ticket.id);
	await invoke('/slack/commands', { ...command('queue'), user_id: 'USUPPORT' });
	expect(calls.filter((c) => c.method === 'chat.postEphemeral').at(-1)?.body.text).toContain(ticket.id);
	await invoke('/slack/commands', { ...command('queue'), user_id: 'USUPPORT', channel_id: 'COTHER' });
	expect(calls.filter((c) => c.method === 'chat.postEphemeral').at(-1)?.body.text).toContain('No open requests');
});
it('refuses commands from another workspace even for the same support user ID', async () => {
	const response = await invoke('/slack/commands', { ...command('queue'), team_id: 'TOTHER', user_id: 'USUPPORT' });
	expect(response.status).toBe(403);
	expect(calls).toHaveLength(0);
});

it('shows the submitted modal request details on the card and status', async () => {
	await invoke('/slack/interactions', { payload: JSON.stringify(submission('Orbit AI API returns 429 for fictional department Cedar')) });
	const ticket = await db.prepare('SELECT id FROM tickets').first<any>();
	expect(calls.find((c) => c.method === 'chat.postMessage')?.body.text).toContain('department Cedar');
	await invoke('/slack/commands', command(`status ${ticket.id}`));
	const status = calls.filter((c) => c.method === 'chat.postEphemeral').at(-1)!;
	expect(status.body.text).toContain('department Cedar');
	expect(status.body.blocks.some((b: any) => b.text?.text.includes('department Cedar'))).toBe(true);
});

it('recovers current-version actions privately after a transition notification fails', async () => {
	const log = vi.spyOn(console, 'error').mockImplementation(() => {});
	await invoke('/slack/interactions', { payload: JSON.stringify(submission('Orbit AI API returns 429')) });
	const ticket = await db.prepare('SELECT id FROM tickets').first<any>();
	vi.mocked(fetch).mockImplementation(async (url, init) => {
		const method = String(url).split('/').pop()!;
		calls.push({ method, body: JSON.parse(String(init?.body)) });
		return Response.json(method === 'chat.postMessage' ? { ok: false } : { ok: true });
	});
	const action = (name: string, version: number, user: string) =>
		invoke('/slack/interactions', {
			payload: JSON.stringify({
				type: 'block_actions',
				team: { id: 'T1' },
				user: { id: user },
				channel: { id: 'C1' },
				actions: [{ action_id: name, value: `${ticket.id}|${version}` }],
			}),
		});
	await action('ticket_claim', 0, 'USUPPORT');
	expect((await getTicket(db, 'T1', 'C1', ticket.id))?.version).toBe(1);
	await invoke('/slack/commands', command(`status ${ticket.id}`));
	const status = calls.filter((c) => c.method === 'chat.postEphemeral').at(-1)!;
	const resolve = status.body.blocks?.find((b: any) => b.type === 'actions')?.elements.find((b: any) => b.action_id === 'ticket_resolve');
	expect(resolve?.value).toBe(`${ticket.id}|1`);
	expect(status.body.blocks.some((b: any) => b.text?.text.includes('History:'))).toBe(true);
	await action('ticket_resolve', 1, 'U1');
	expect((await getTicket(db, 'T1', 'C1', ticket.id))?.status).toBe('resolved');
	expect(log).toHaveBeenCalled();
});
