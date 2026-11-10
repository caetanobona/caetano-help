# Interview preparation — honest portfolio narrative

## A concise introduction

“I did not have professional experience building Slack bots, so I built a
focused support-workflow project for this application. It uses signed Slack
webhooks, slash commands, interactive cards and modals, plus persisted ticket
state and audit history. The triage layer retrieves fictional runbook evidence,
asks when context is missing and prepares human escalation summaries. I tested
it locally with workerd, D1 and a mocked Slack API. Live Slack verification is a
separate step; I will only describe it as completed after actually doing it.”

If you have not personally read or run a part, do not claim that you have. This
was built with AI assistance. Read the paths below, run the demo and be ready
to explain the decisions in your own words before presenting it.

## Questions to practice

| Question | What to explain / show |
| --- | --- |
| How do you trust an incoming Slack request? | `signature.ts`: exact raw body, timestamp window, HMAC verify; same for form and JSON endpoints. Signing secret differs from bot token. |
| Why return 200 before posting a message? | Slack acknowledgement deadline vs background API latency. `waitUntil` extends work but is not a durable queue. |
| How does the modal open? | Slash command supplies short-lived trigger_id; views.open uses it immediately, submission validates block_id/action_id state and private context. |
| What stops someone clicking another user's Resolve button? | Server-side policy, workspace/channel lookup, requester/support allowlist and version predicate. Button visibility is not authorization. |
| How do you avoid duplicate tickets? | Unique tenant/source key; conditional inserts and versioned updates. Distinguish one DB transition from exactly-once external delivery. |
| What if the process dies during publication? | Persisted state can remain, delivery may remain attempted/failed, no recovery worker. Explain the outbox improvement instead of claiming reliability. |
| Why do you call this AI tooling if there is no model? | It supports AI-tool incidents and demonstrates retrieval/evaluation; it is not generative AI/RAG. A real grounded generator is a separate extension. |
| Does 24/24 mean production-ready? | No. Synthetic development cases informed rules. Show per-category metrics and limitations; discuss separate held-out data and user feedback. |
| What would you measure as Support Lead? | Time to acknowledgement/assignment/resolution, reopen rate, escalation quality, source usefulness. Current demo stores audit times; it does not claim real operational KPIs. |
| What would change before production? | Durable inbox/outbox, retries/reconciliation, retention/uninstall policy, better auth provisioning, real evaluation and monitoring. |

## Suggested learning order

1. Run `npm run demo:build` and explore the offline page. Inspect payload JSON.
2. Read one signed-event test and one workflow test. Follow the boundary from
   request signature to DB mutation and API payload.
3. Read `slack-ui.ts`, then `support.ts`, then `tickets.ts` and the migration.
4. Run `npm run eval` and explain why an unsupported product gets no source.
5. Draw the ACK/data flow from memory and explain one crash window.
6. Perform the owner-only Slack checklist before saying the app works in Slack.

## What to show in five minutes

A support request with a real source citation; an ambiguous request; a modal;
role-checked escalation and resolution; one negative test; and the explicit
boundary between an offline demo and a production system. A small, understood
project is a stronger interview artifact than unsupported feature claims.
