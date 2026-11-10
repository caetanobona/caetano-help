import { verifySlackRequest } from './signature';
import { formatReply, triage } from './triage';

interface Env {
	SLACK_SIGNING_SECRET: string;
	SLACK_BOT_TOKEN: string;
}

interface SlackPayload {
	type?: string;
	challenge?: string;
	event_id?: string;
	event?: {
		type?: string;
		channel?: string;
		ts?: string;
		thread_ts?: string;
		text?: string;
		bot_id?: string;
		subtype?: string;
	};
}

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		if (new URL(request.url).pathname !== '/slack/events') {
			return new Response('Not Found', { status: 404 });
		}

		if (request.method !== 'POST') {
			return new Response('Method Not Allowed', {
				status: 405,
				headers: { Allow: 'POST' },
			});
		}

		if (!env.SLACK_SIGNING_SECRET || !env.SLACK_BOT_TOKEN) {
			console.error('Configure SLACK_SIGNING_SECRET e SLACK_BOT_TOKEN.');
			return new Response('Worker configuration error', { status: 500 });
		}

		// O Slack assina o corpo original. Valide antes de interpretar o JSON.
		// https://docs.slack.dev/authentication/verifying-requests-from-slack/
		const rawBody = await request.text();

		if (!(await verifySlackRequest(request, rawBody, env.SLACK_SIGNING_SECRET))) {
			return new Response('Invalid Slack signature', { status: 401 });
		}

		let body: SlackPayload | null;
		try {
			body = JSON.parse(rawBody);
		} catch {
			return new Response('Invalid JSON', { status: 400 });
		}

		if (!body || typeof body.type !== 'string') {
			return new Response('Invalid Slack payload', { status: 400 });
		}

		// Na configuração do app, o Slack espera receber o challenge de volta.
		if (body.type === 'url_verification') {
			if (typeof body.challenge !== 'string') {
				return new Response('Missing challenge', { status: 400 });
			}

			return new Response(body.challenge);
		}

		const event = body.event;
		if (body.type !== 'event_callback' || event?.type !== 'app_mention') {
			return new Response('OK');
		}

		if (event.bot_id || event.subtype === 'bot_message') {
			return new Response('OK');
		}

		if (
			typeof event.channel !== 'string' ||
			!event.channel.trim() ||
			typeof event.ts !== 'string' ||
			!event.ts.trim() ||
			(event.thread_ts !== undefined && (typeof event.thread_ts !== 'string' || !event.thread_ts.trim())) ||
			(event.text !== undefined && typeof event.text !== 'string')
		) {
			return new Response('Invalid mention event', { status: 400 });
		}

		// Use a thread existente ou abra uma na mensagem que mencionou o bot.
		const threadTs = event.thread_ts ?? event.ts;

		// O 200 confirma o evento. A chamada abaixo publica a mensagem no Slack.
		// https://docs.slack.dev/apis/events-api/#responding-to-events
		// https://developers.cloudflare.com/workers/runtime-apis/context/#waituntil
		// shortcut: reenvios podem gerar respostas duplicadas. Deduplicar por
		// event_id com armazenamento persistente antes de usar fora da demo.
		ctx.waitUntil(postReply(env.SLACK_BOT_TOKEN, event.channel, threadTs, formatReply(triage(event.text ?? ''))));

		return new Response('OK');
	},
};

async function postReply(token: string, channel: string, threadTs: string, text: string): Promise<void> {
	// Best effort only: ACK is independent of this post, and there is no durable queue.
	// Do not log request text, tokens, or upstream error strings.
	try {
		const response = await fetch('https://slack.com/api/chat.postMessage', {
			method: 'POST',
			signal: AbortSignal.timeout(5_000),
			headers: {
				Authorization: `Bearer ${token}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				channel,
				thread_ts: threadTs,
				text,
				mrkdwn: false,
				parse: 'none',
				unfurl_links: false,
				unfurl_media: false,
			}),
		});
		if (!response.ok) {
			console.error('Slack reply failed', { code: 'http_error' });
			return;
		}
		const result: unknown = await response.json();
		if (!result || typeof result !== 'object' || !('ok' in result) || result.ok !== true) {
			console.error('Slack reply failed', { code: 'api_error' });
		}
	} catch {
		console.error('Slack reply failed', { code: 'transport_error' });
	}
}
