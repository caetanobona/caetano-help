import { createExecutionContext } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import worker from "../src/index";

const env = {
  SLACK_SIGNING_SECRET: "test-signing-secret",
  SLACK_BOT_TOKEN: "test-bot-token",
};
const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;
const url = "https://example.com/slack/events";
const challenge = JSON.stringify({ type: "url_verification", challenge: "abc123" });

async function signedHeaders(body: string, timestamp = Math.floor(Date.now() / 1000)) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(env.SLACK_SIGNING_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign("HMAC", key, encoder.encode(`v0:${timestamp}:${body}`));
  const hex = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  return {
    "X-Slack-Request-Timestamp": String(timestamp),
    "X-Slack-Signature": `v0=${hex}`,
  };
}

describe("Slack events endpoint", () => {
  it("rejects paths and methods outside POST /slack/events", async () => {
    const ctx = createExecutionContext();
    const wrongPath = await worker.fetch(new IncomingRequest("https://example.com"), env, ctx);
    const wrongMethod = await worker.fetch(new IncomingRequest(url), env, ctx);
    expect(wrongPath.status).toBe(404);
    expect(wrongMethod.status).toBe(405);
    expect(wrongMethod.headers.get("Allow")).toBe("POST");
  });

  it("echoes a signed Slack challenge", async () => {
    const request = new IncomingRequest(url, {
      method: "POST",
      body: challenge,
      headers: await signedHeaders(challenge),
    });
    const response = await worker.fetch(request, env, createExecutionContext());
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("abc123");
  });

  it("rejects a body modified after signing", async () => {
    const request = new IncomingRequest(url, {
      method: "POST",
      body: challenge.replace("abc123", "tampered"),
      headers: await signedHeaders(challenge),
    });
    expect((await worker.fetch(request, env, createExecutionContext())).status).toBe(401);
  });

  it("rejects old signed requests", async () => {
    const timestamp = Math.floor(Date.now() / 1000) - 301;
    const request = new IncomingRequest(url, {
      method: "POST",
      body: challenge,
      headers: await signedHeaders(challenge, timestamp),
    });
    expect((await worker.fetch(request, env, createExecutionContext())).status).toBe(401);
  });
});
