# Codex Cloud task

Complete Caetano-Help as a portfolio demo for an AI Engineer & Support Lead
role. Build on the TypeScript Worker and Slack Events API. Deliver reviewable
code, automated checks, and a short demo walkthrough.

1. Triage realistic AI-tool support requests (access, integration failures,
   and new use cases). Classify and route each request, ask one focused
   follow-up when needed, and summarize escalations for a human.
2. Retrieve relevant excerpts from fictional runbooks and include source
   references. If the evidence is insufficient, ask or escalate. Keep the
   default path deterministic and runnable without credentials. If an
   optional LLM adds value, validate its structured output and fall back on
   timeout or failure. Call it RAG only if it generates from retrieved text.
3. Test signed Slack events with a mocked Slack Web API. Cover ACK and reply
   payloads, new and existing threads, failed posts, and duplicate deliveries
   if implementing deduplication. Preserve signature checks. Describe
   delivery guarantees and retry tradeoffs.
4. Add labeled evaluation cases including ambiguous and out-of-scope
   requests. Report what the evaluation measures. Add a short demo script
   that explains the webhook, ACK, thread reply, retrieval, and escalation.

Use fictional data and keep dependencies small. No Slack, Cloudflare, or
model credentials are available. Use fakes, with no live deploy or paid
services. The owner will configure Slack and run the live smoke test.

Run npm ci, npx tsc --noEmit, and npm test -- --run using Node.js 24 where
available. Summarize test results, decisions, and live verification steps.
The proposed 80% of the five-hour allowance is a preference to leave headroom.
Prioritize the core demo and stop when acceptance checks pass. Treat the
account quota as unobservable unless the environment actually exposes it.
