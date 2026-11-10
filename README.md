# Caetano-Help

A Slack support-workflow portfolio project for an **AI Engineer & Support Lead**
application. TypeScript on Cloudflare Workers, local D1 persistence, fictional
runbook evidence and an offline demo. Built with AI assistance; see the
[interview guide](docs/INTERVIEW.md) for an honest account of what it demonstrates.

![Offline demo of a support request with cited evidence](docs/images/offline-demo.png)

## What you can demonstrate

- Signed Events API, slash commands, Block Kit buttons and a modal form.
- `/caetano new`, `list`, `queue` and `status ID`.
- Persistent tickets with category, priority, owner, status and atomic audit history.
- Authorized claim/escalate/resolve actions; workspace/channel isolation and
  version checks against duplicate or stale clicks.
- Deduplicated intake and one automatic publication attempt per delivery key.
- Fictional runbook retrieval with sources, focused questions and human summaries.
- Offline visual explorer, synthetic evaluation report and failure-path tests.

The triage is deterministic retrieval plus templates, **not generative RAG**.
No model credential, paid API or production customer data is required.

## Run locally (Node.js 24)

```bash
npm ci
npm run test:types
npm test -- --run
npm run eval
npm run db:local
npx wrangler deploy --dry-run --outdir /tmp/caetano-help-build
```

In the managed cloud, first use writable tooling paths:

```bash
export XDG_CONFIG_HOME=/workspace/.cloud-config
export WRANGLER_LOG_PATH=/tmp/caetano-help-wrangler-logs
export WRANGLER_SEND_METRICS=false
export npm_config_cache=/tmp/caetano-help-npm-cache
mkdir -p "$XDG_CONFIG_HOME"
```

All tests use real workerd/local D1 with a fake external Slack transport. The
checked-in DB UUID is a **local-only placeholder**. `db:local` creates/migrates
local state; dry-run only bundles. Neither provisions nor deploys a remote app.
`.dev.vars.example` contains fake local settings; never commit real credentials.
Do not send events to a locally running Worker with real tokens during offline
validation: tests and the visual demo are the paths that fake Slack transport.

## Explore without Slack

```bash
npm run demo:build
python3 -m http.server 4173 --directory dist/demo --bind 127.0.0.1
```

Open the local server in your own browser. Select a labeled example or type a
fictional request; inspect the actual triage and Block Kit payload. The page
approximates Slack rendering and does not persist tickets or contact Slack.
The lifecycle tests exercise the actual backend. See [demo script](docs/DEMO.md).

## Read next

- [Owner-only Slack setup and smoke test](docs/SLACK_SETUP.md)
- [Architecture, authorization and delivery tradeoffs](docs/ARCHITECTURE.md)
- [Interview preparation](docs/INTERVIEW.md)
- [Validation evidence](docs/VERIFICATION.md)
- [Fictional source runbooks](docs/runbooks.md)
- [Active goal and progress](docs/GOAL.md)

Important boundary: durable ticket state does not guarantee delivery of a Slack
notification. There is no automatic recovery queue; failures/crashes can lose
notifications. Requesters can consult saved state with commands. Deployment,
app installation, remote migration and live Slack verification remain owner-only
review steps. No professional or production experience is implied by this demo.
