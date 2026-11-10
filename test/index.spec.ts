import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from '../src/index';

const env = {
	SLACK_SIGNING_SECRET: 'test-signing-secret',
	SLACK_BOT_TOKEN: 'test-bot-token',
};
const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;
const url = 'https://example.com/slack/events';
const challenge = JSON.stringify({ type: 'url_verification', challenge: 'abc123' });

async function signedHeaders(body: string, timestamp = Math.floor(Date.now() / 1000)) {
	const encoder = new TextEncoder();
	const key = await crypto.subtle.importKey('raw', encoder.encode(env.SLACK_SIGNING_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, [
		'sign',
	]);
	const digest = await crypto.subtle.sign('HMAC', key, encoder.encode(`v0:${timestamp}:${body}`));
	const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
	return {
		'X-Slack-Request-Timestamp': String(timestamp),
		'X-Slack-Signature': `v0=${hex}`,
	};
}

describe('Slack events endpoint', () => {
	it('rejects paths and methods outside POST /slack/events', async () => {
		const ctx = createExecutionContext();
		const wrongPath = await worker.fetch(new IncomingRequest('https://example.com'), env, ctx);
		const wrongMethod = await worker.fetch(new IncomingRequest(url), env, ctx);
		expect(wrongPath.status).toBe(404);
		expect(wrongMethod.status).toBe(405);
		expect(wrongMethod.headers.get('Allow')).toBe('POST');
	});

	it('echoes a signed Slack challenge', async () => {
		const request = new IncomingRequest(url, {
			method: 'POST',
			body: challenge,
			headers: await signedHeaders(challenge),
		});
		const response = await worker.fetch(request, env, createExecutionContext());
		expect(response.status).toBe(200);
		expect(await response.text()).toBe('abc123');
	});

	it('rejects a body modified after signing', async () => {
		const request = new IncomingRequest(url, {
			method: 'POST',
			body: challenge.replace('abc123', 'tampered'),
			headers: await signedHeaders(challenge),
		});
		expect((await worker.fetch(request, env, createExecutionContext())).status).toBe(401);
	});

	it('rejects old signed requests', async () => {
		const timestamp = Math.floor(Date.now() / 1000) - 301;
		const request = new IncomingRequest(url, {
			method: 'POST',
			body: challenge,
			headers: await signedHeaders(challenge, timestamp),
		});
		expect((await worker.fetch(request, env, createExecutionContext())).status).toBe(401);
	});
});

async function signedRequest(payload: unknown) {
	const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
	return new IncomingRequest(url, { method: 'POST', body, headers: await signedHeaders(body) });
}
function mention(overrides: Record<string, unknown> = {}) {
	return {
		type: 'event_callback',
		event_id: 'Ev-demo-1',
		event: {
			type: 'app_mention',
			user: 'U-DEMO',
			channel: 'C-DEMO',
			ts: '1700000000.001',
			text: '<@UBOT> Atlas AI API returns 429',
			...overrides,
		},
	};
}
afterEach(() => vi.restoreAllMocks());

describe('signed Slack mentions with a fake Web API', () => {
	for (const thread of [undefined, '1699999999.002']) {
		it(`ACKs before Slack completes and posts triage in ${thread ? 'existing' : 'new'} thread`, async () => {
			let finish!: (response: Response) => void;
			const pending = new Promise<Response>((resolve) => {
				finish = resolve;
			});
			const transport = vi.spyOn(globalThis, 'fetch').mockReturnValue(pending);
			const ctx = createExecutionContext();
			const response = await worker.fetch(await signedRequest(mention(thread ? { thread_ts: thread } : {})), env, ctx);
			expect(response.status).toBe(200);
			expect(await response.text()).toBe('OK');
			expect(transport).toHaveBeenCalledTimes(1);
			const [endpoint, init] = transport.mock.calls[0];
			expect(endpoint).toBe('https://slack.com/api/chat.postMessage');
			expect(init?.method).toBe('POST');
			expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer test-bot-token');
			expect(init?.signal).toBeInstanceOf(AbortSignal);
			const post = JSON.parse(String(init?.body));
			expect(post.channel).toBe('C-DEMO');
			expect(post.thread_ts).toBe(thread ?? '1700000000.001');
			expect(post.text).toContain('Integration Engineering');
			expect(post.text).toContain('RB-INTEGRATION');
			expect(post.text).toContain('Retry-After');
			expect(post.unfurl_links).toBe(false);
			expect(post.parse).toBe('none');
			finish(Response.json({ ok: true, channel: 'C-DEMO', ts: '1700000001.001', message: { text: post.text } }));
			await waitOnExecutionContext(ctx);
		});
	}
	const failures = [
		{ name: 'HTTP rate limit', response: () => Promise.resolve(new Response('rate limited', { status: 429 })), code: 'http_error' },
		{
			name: 'Slack API rejection',
			response: () => Promise.resolve(Response.json({ ok: false, error: 'invalid_auth' })),
			code: 'api_error',
		},
		{ name: 'network failure', response: () => Promise.reject(new Error('secret-token must not be logged')), code: 'transport_error' },
		{ name: 'timeout', response: () => Promise.reject(new DOMException('timed out', 'TimeoutError')), code: 'transport_error' },
		{ name: 'invalid response', response: () => Promise.resolve(new Response('not JSON')), code: 'transport_error' },
	];
	for (const failure of failures) {
		it(`keeps ACK and records sanitized metadata on ${failure.name}`, async () => {
			const log = vi.spyOn(console, 'error').mockImplementation(() => {});
			const transport = vi.spyOn(globalThis, 'fetch').mockImplementation(failure.response);
			const ctx = createExecutionContext();
			const response = await worker.fetch(await signedRequest(mention()), env, ctx);
			expect(response.status).toBe(200);
			await waitOnExecutionContext(ctx);
			expect(transport).toHaveBeenCalledTimes(1); // no unsafe post-ACK retry
			expect(log).toHaveBeenCalledWith('Slack reply failed', { code: failure.code });
			expect(JSON.stringify(log.mock.calls)).not.toMatch(/secret-token|test-bot-token|invalid_auth|Atlas/);
		});
	}
	it('documents best-effort duplicate behavior with two deliveries of the same event', async () => {
		const transport = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ ok: true }));
		for (let i = 0; i < 2; i++) {
			const ctx = createExecutionContext();
			const response = await worker.fetch(await signedRequest(mention()), env, ctx);
			expect(response.status).toBe(200);
			await waitOnExecutionContext(ctx);
		}
		expect(transport).toHaveBeenCalledTimes(2);
	});
	it.each([{ bot_id: 'B-DEMO' }, { subtype: 'bot_message' }])('ignores bot-generated mentions %j', async (overrides) => {
		const transport = vi.spyOn(globalThis, 'fetch');
		const ctx = createExecutionContext();
		expect((await worker.fetch(await signedRequest(mention(overrides)), env, ctx)).status).toBe(200);
		await waitOnExecutionContext(ctx);
		expect(transport).not.toHaveBeenCalled();
	});
	it.each([{ channel: '' }, { ts: '' }, { thread_ts: 42 }, { thread_ts: '' }, { text: 42 }])(
		'rejects malformed mention fields %j',
		async (overrides) => {
			const transport = vi.spyOn(globalThis, 'fetch');
			const ctx = createExecutionContext();
			expect((await worker.fetch(await signedRequest(mention(overrides)), env, ctx)).status).toBe(400);
			expect(transport).not.toHaveBeenCalled();
		},
	);
	it('asks a focused question for a mention without text', async () => {
		const transport = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ ok: true }));
		const ctx = createExecutionContext();
		await worker.fetch(await signedRequest(mention({ text: undefined })), env, ctx);
		await waitOnExecutionContext(ctx);
		const post = JSON.parse(String(transport.mock.calls[0][1]?.body));
		expect(post.text).toContain('what exact behavior');
		expect(post.text).toContain('Sources: none');
	});
	it('never posts on an invalid signature', async () => {
		const transport = vi.spyOn(globalThis, 'fetch');
		const response = await worker.fetch(
			new IncomingRequest(url, { method: 'POST', body: JSON.stringify(mention()) }),
			env,
			createExecutionContext(),
		);
		expect(response.status).toBe(401);
		expect(transport).not.toHaveBeenCalled();
	});
	it.each(['{broken', 'null', '[]', '42', '{"type":"url_verification"}'])('rejects malformed signed payload %s', async (body) => {
		const response = await worker.fetch(await signedRequest(body), env, createExecutionContext());
		expect(response.status).toBe(400);
	});
});
