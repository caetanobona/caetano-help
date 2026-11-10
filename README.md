# Caetano-Help

TypeScript Slack support bot on Cloudflare Workers. The baseline verifies signed
requests, handles the Slack challenge, and schedules a reply to a mention.

## Local checks

With Node.js 24, run npm ci, npx tsc --noEmit, and npm test -- --run.
Tests use fake credentials.

## Live test

1. Install the Slack app with app_mentions:read and chat:write under Bot Scopes.
2. Set SLACK_SIGNING_SECRET and SLACK_BOT_TOKEN as Cloudflare Worker secrets.
3. Deploy to the existing caetano-help Worker with npm run deploy.
4. In Slack Event Subscriptions, set the deployed URL plus /slack/events and
   subscribe to the app_mention bot event.
5. Invite the app to a test channel, mention it, and verify its thread reply.

See [Cloud task](CLOUD_TASK.md) for the implementation scope.
