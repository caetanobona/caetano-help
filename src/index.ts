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
  };
}

const encoder = new TextEncoder();

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    if (new URL(request.url).pathname !== "/slack/events") {
      return new Response("Not Found", { status: 404 });
    }

    if (request.method !== "POST") {
      return new Response("Method Not Allowed", {
        status: 405,
        headers: { Allow: "POST" },
      });
    }

    if (!env.SLACK_SIGNING_SECRET || !env.SLACK_BOT_TOKEN) {
      console.error("Configure SLACK_SIGNING_SECRET e SLACK_BOT_TOKEN.");
      return new Response("Worker configuration error", { status: 500 });
    }

    // O Slack assina o corpo original. Valide antes de interpretar o JSON.
    // https://docs.slack.dev/authentication/verifying-requests-from-slack/
    const rawBody = await request.text();

    if (!(await verifySlackRequest(request, rawBody, env.SLACK_SIGNING_SECRET))) {
      return new Response("Invalid Slack signature", { status: 401 });
    }

    let body: SlackPayload | null;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }

    if (!body || typeof body.type !== "string") {
      return new Response("Invalid Slack payload", { status: 400 });
    }

    // Na configuração do app, o Slack espera receber o challenge de volta.
    if (body.type === "url_verification") {
      if (typeof body.challenge !== "string") {
        return new Response("Missing challenge", { status: 400 });
      }

      return new Response(body.challenge);
    }

    const event = body.event;
    if (body.type !== "event_callback" || event?.type !== "app_mention") {
      return new Response("OK");
    }

    if (typeof event.channel !== "string" || typeof event.ts !== "string") {
      return new Response("Invalid mention event", { status: 400 });
    }

    // Use a thread existente ou abra uma na mensagem que mencionou o bot.
    const threadTs = event.thread_ts ?? event.ts;

    // O 200 confirma o evento. A chamada abaixo publica a mensagem no Slack.
    // https://docs.slack.dev/apis/events-api/#responding-to-events
    // https://developers.cloudflare.com/workers/runtime-apis/context/#waituntil
    // shortcut: reenvios podem gerar respostas duplicadas. Deduplicar por
    // event_id com armazenamento persistente antes de usar fora da demo.
    ctx.waitUntil(
      postReply(env.SLACK_BOT_TOKEN, event.channel, threadTs).catch((error) => {
        console.error("Could not post Slack reply", {
          eventId: body.event_id,
          error: error instanceof Error ? error.message : String(error),
        });
      }),
    );

    return new Response("OK");
  },
};

async function verifySlackRequest(
  request: Request,
  rawBody: string,
  signingSecret: string,
): Promise<boolean> {
  const timestamp = request.headers.get("X-Slack-Request-Timestamp");
  const signature = request.headers.get("X-Slack-Signature");

  if (!timestamp || !/^\d+$/.test(timestamp)) {
    return false;
  }

  if (!signature || !/^v0=[0-9a-f]{64}$/.test(signature)) {
    return false;
  }

  // A janela de cinco minutos limita o reaproveitamento de pedidos antigos.
  const ageInSeconds = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (ageInSeconds > 300) {
    return false;
  }

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(signingSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );

  // O Slack envia o HMAC em hexadecimal. Web Crypto recebe os bytes.
  const signatureBytes = new Uint8Array(32);
  for (let index = 0; index < signatureBytes.length; index++) {
    const offset = 3 + index * 2; // Pula o prefixo "v0=".
    signatureBytes[index] = Number.parseInt(signature.slice(offset, offset + 2), 16);
  }

  return crypto.subtle.verify(
    "HMAC",
    key,
    signatureBytes,
    encoder.encode(`v0:${timestamp}:${rawBody}`),
  );
}

async function postReply(
  token: string,
  channel: string,
  threadTs: string,
): Promise<void> {
  const response = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      channel,
      thread_ts: threadTs,
      text: "Hi! I’m Caetano-Help. What do you need help with?",
    }),
  });

  if (!response.ok) {
    throw new Error(`Slack returned HTTP ${response.status}`);
  }

  // A Web API também pode devolver HTTP 200 com ok: false.
  // https://docs.slack.dev/reference/methods/chat.postMessage/
  const result = (await response.json()) as { ok: boolean; error?: string };
  if (!result.ok) {
    throw new Error(result.error ?? "Slack rejected the message");
  }
}