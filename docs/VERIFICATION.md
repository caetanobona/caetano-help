# Verification record

On 2026-11-10, a live Slack mention created a D1 ticket and posted its card
in the thread. After the card and form update, all 74 automated tests passed
with remote bindings disabled, and the Worker update was deployed. The
latest offline screenshot shows the updated card. Use the
[Slack smoke test](SLACK_SETUP.md#live-smoke-test) to verify the full workflow
on a specific installation.

## Initial offline baseline

Validated in the cloud checkout on 2026-11-10 with Node.js 24.22.1.

| Check | Result |
| --- | --- |
| `npm ci --cache /tmp/caetano-help-npm-cache` | passed; 81 packages installed from lockfile |
| `npm run test:types` | source, official Slack payload types and test TypeScript checks passed |
| `npm test -- --run` | 74 passed, 5 files, no failures/skips |
| `npm run eval` | 24/24 category, route, action and exact source-ID decisions; per-category counts emitted |
| `npm run db:local` | migration applied locally, second application reports no pending migrations |
| `npx wrangler deploy --dry-run --outdir /tmp/caetano-help-build` | passed; 26.01 KiB bundle, no deployment |
| `node scripts/check-demo.mjs` | real headless Chromium checks passed; screenshot refreshed |
| `git diff --check` | passed |

Tests run the actual Worker handler and local D1 SQL, with only the external
Slack HTTP transport mocked. Coverage includes signed JSON/forms, modal errors,
three end-to-end portfolio scenarios, workspace/channel isolation, authorization,
concurrent claim, atomic audit, stale clicks, deduplicated intake/publication,
persisted requests after failed Slack posts, and support-only queue access.
An abort-aware fake verifies the actual 2.5-second deadline fires; it is not
merely a pre-rejected timeout promise. The older no-storage transport retains
its separate baseline tests.

The browser check covers initial rendering, scenario switching, custom-input
DOM escaping and mobile overflow. It is a local Block Kit approximation, not
an official Slack renderer or live Slack validation.

Evaluation uses a 24-case synthetic development regression set, not held-out
traffic. Metrics describe those exact labeled decisions, not real-world accuracy,
remediation success, model quality or production reliability.

No Slack Web API call, remote database provisioning/migration, deploy, paid service,
push, merge or environment publication was performed. GitHub Actions configuration
was added but its hosted execution has not been observed. Manifest import,
workspace app capacity, current plan entitlements and live API behavior remain
owner-only review. Direct Slack docs/help requests were denied (HTTP 403);
payload shapes are checked against official @slack/types and SDK sources.

Independent review identified two functional gaps: failed card posts left no
current actionable card, and ordinary modal cards omitted the submitted details.
Both were reproduced with failing regression tests and fixed. Status now returns
an authorized current-version ephemeral card, visible recent audit history and
safe request details; workflow remains usable after notification failure.
The final full 74-test suite, both typechecks, evaluation, bundle and browser
checks passed after those fixes. No review finding was left unresolved.
