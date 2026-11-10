# Five-minute demonstration

## 1. Introduce the workflow (30 seconds)

Caetano-Help turns Slack requests about AI tools into tickets that people can
track in the original channel. Open the README preview and trace a request
from Slack through the Worker, D1, and the reply card using the
[architecture diagram](ARCHITECTURE.md).

## 2. Explore evidence offline (60 seconds)

Run `npm run demo:build`, then serve `dist/demo` with a local HTTP server as in
README.md. The page uses the real triage and card renderer, with no API calls.
Show access, integration and a new use case. Inspect the source ID, routing and
payload JSON. Try ambiguity or an unknown product: no invented runbook source.
The buttons here are disabled because the page is a visual explorer, not a
second backend or an actual Slack client.

## 3. Show the full workflow (90 seconds)

```bash
npm test -- --run test/workflow.spec.ts test/tickets.spec.ts
```

Read the named lifecycle assertions in `test/workflow.spec.ts`: a signed slash
command opens a modal; a signed submission creates a request and sourced card;
a support user claims it; the requester escalates it; an authorized user
resolves it. Each transition posts in the same thread, and status reads audit
history. The three portfolio scenarios each reach resolution in tests:

| Scenario | Evidence / responsible team |
| --- | --- |
| `Atlas AI SSO login denied` | RB-ACCESS / Identity & Access |
| `Orbit AI API returns 429` | RB-INTEGRATION / Integration Engineering |
| `Can Atlas AI summarize support tickets for a new use case?` | RB-USECASE / AI Enablement |

In real Slack after your review, use `/caetano-help new`, `/caetano-help list`,
`/caetano-help queue` (configured support only), and `/caetano-help status ID`.
Requesters can escalate/resolve their own tickets. Only the configured support
allowlist may claim requests. Resolved requests are terminal. No actual on-call
page, external ticket or team assignment outside this app is created.

## 4. Show one failure and one race (60 seconds)

Show the test rejecting another user's resolution and a different workspace.
Then show concurrent claim attempts: only one SQL version check succeeds, with
one audit record. Duplicate intake produces one ticket/post attempt. When Slack
rejects a creation post, the persisted request still exists; status remains the
recovery path. The transport abort deadline is tested against an abort-aware
nonresponding fake. All external Slack HTTP is mocked, not sent live.

## 5. Explain evaluation and limits (60 seconds)

Run `npm run eval`. It prints category, route, action and exact source-ID
accuracy, per-category counts and failed case IDs over 24 synthetic development
examples. Cases include Portuguese, malicious embedded instructions, incidents,
unknown tools, ambiguity and out-of-scope requests. This is a regression report,
not a held-out generalization benchmark. Static citations do not establish that
fictional advice fixes a real service. There is no LLM/RAG claim.

Explain one crash window: saving a ticket, reserving a delivery and contacting
Slack are not one transaction. Deduplication does not imply exactly-once
notification. There is no durable queue/recovery consumer; an ACK can outlive
failed background work. See ARCHITECTURE.md for the exact guarantees and next
production steps. No paid feature is configured.

## Optional browser regression check

With the static server above running, start a separate local headless Chromium:

```bash
chromium --headless --no-sandbox --disable-dev-shm-usage \
  --remote-debugging-port=9222 --user-data-dir=/tmp/caetano-preview-chrome about:blank
node scripts/check-demo.mjs
```

This optional development check needs Chromium and a free local port 9222. It
checks scenario switching, custom-input DOM escaping and narrow-screen layout,
and refreshes `docs/images/offline-demo.png`. It uses only loopback traffic.
Close only the server/browser processes you started when done.
