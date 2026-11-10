# Slack and Cloudflare setup

Use this guide to install the app in a Slack workspace and verify the ticket flow.

## What the app uses

Basic custom Slack app APIs: signed events, slash commands, Block Kit,
interactive messages, modals, `chat.postMessage`, `chat.postEphemeral` and
`views.open`. No Workflow Builder, Slack AI, premium search, workspace-history
access or paid API is required by the implementation. Before installation,
check your free workspace's current app allowance and admin installation policy.
An existing app may occupy a slot; there is no need to install several apps.
Current plan limits can change: verify Slack's official free-plan help page.

## Configuration

1. Review the branch and run local checks first. Keep the fictional content
   until the demo has been reviewed; this is not production incident tooling.
2. Create or select a D1 database in your Cloudflare account. In
   `wrangler.jsonc`, set its `database_name` and `database_id` under the `DB`
   binding. Set `remote: false` if you want `wrangler dev` to use local storage.
3. Apply migrations remotely only during your approved deploy session. Use
   `npx wrangler d1 migrations apply DB --remote`, then deploy the reviewed
   Worker with `npm run deploy`. No remote command is part of local setup.
4. In Slack app management, create/import `app.manifest.json`. Replace every
   `https://YOUR-WORKER.workers.dev` with your deployed Worker origin. The
   Events API path is `/slack/events`, command path `/slack/commands`, and
   interactivity path `/slack/interactions`. They all verify Slack signatures.
5. Securely configure Worker secrets `SLACK_SIGNING_SECRET` and
   `SLACK_BOT_TOKEN` (the installed bot token). Configure nonsecret runtime
   values `SLACK_TEAM_ID` and `SUPPORT_USER_IDS` (comma-separated Slack user IDs).
   IDs are not display names; use your workspace ID and designated demo support
   user. Ticket workflows refuse an unconfigured or different workspace.
   Never commit actual values or paste credentials in chat.
6. Confirm bot scopes `app_mentions:read`, `chat:write` and `commands`; reinstall
   the app if scopes changed. No `chat:write.public` or history-reading scope is
   requested. Invite the bot to a private test channel; it cannot post to an
   arbitrary unjoined channel. Turn on interactivity and the `app_mention` event.
7. Deploy the correct secret/variable configuration, then verify Slack's signed
   URL challenge. App import may require the live endpoint before URL validation
   completes; configure the deployed endpoint and secrets before retrying.

## Live smoke test

For an existing app, add **Create support ticket** under **Interactivity &
Shortcuts → Create New Shortcut → On messages**. Use callback ID
`create_support_ticket` and description `Open a ticket from this Slack message`.
The shortcut uses the existing interactions endpoint and the `commands` scope.
Use it in a channel where the bot is a member.

- `/caetano-help help`: private instructions; no channel spam.
- `/caetano-help new`: opens a modal promptly. Try an empty request: inline error.
- Post `I cannot get into the tool` and use **More actions → Create support
  ticket**. Check that the modal prefills the message and that the card appears
  in the original thread. Repeat the shortcut and check that it creates no
  second ticket.
- On that card, select **Add details** and clarify with `Atlas AI SSO login
  denied`. Check that the same ticket ID returns runbook `RB-ACCESS` and that
  `/caetano-help status ID` shows the details update in its history.
- Submit `Atlas AI SSO login denied` at normal impact: one persisted card with
  ID, source RB-ACCESS, route and action buttons.
- As the configured support user, click Take ownership. The new card appears
  in the same thread with the assignee and next version.
- As requester, click Need human review on the latest card. Inspect summary,
  impact and missing information. No real on-call notification is implied.
- Resolve on the latest card. `/caetano-help status ID` shows durable state/history.
  A repeat/stale click must not create a second transition.
- Repeat with `Orbit AI API returns 429` and
  `Can Atlas AI summarize support tickets for a new use case?`.
- Mention the bot in a new thread and an existing thread. Each event becomes a
  request. Exact event redelivery should not create another request/post attempt.
- `/caetano-help list`: your last ten requests in that channel.
- `/caetano-help queue`: support-only list of up to ten unresolved requests in that
  channel, reported high impact first. Another user must not receive the queue.
- Verify another user cannot resolve your request; requester/support can.
  Use only consenting demo accounts and synthetic content.

## Troubleshooting

- No modal: confirm commands/interactivity URLs, `commands` scope and valid
  trigger. Triggers expire quickly; rerun the command instead of replaying one.
- No ticket response: confirm D1 binding/migration and configured workspace ID.
  Read sanitized failure codes and inspect the request through `/caetano-help list`
  and `/caetano-help status ID` before resubmitting. A post-ACK failure is possible.
- Missing permission/not in channel: reinstall for new scopes and invite the bot.
- Stale button: act on the most recent card; use the status/history command to obtain a private current-version card.
- Rate limit/timeout: no automatic retry is performed. The recorded attempt may
  have an unknown result. Do not repeatedly resubmit and create duplicates.

Official references: https://docs.slack.dev/interactivity/implementing-slash-commands/
https://docs.slack.dev/surfaces/modals/
https://docs.slack.dev/authentication/verifying-requests-from-slack/
https://slack.com/help/articles/27204752526611-Feature-limitations-on-the-free-version-of-Slack
Direct access to Slack's documentation/help site was denied by this environment
(HTTP 403). Payload shapes were checked against the official @slack/types package
and official slackapi/node-slack-sdk source; live app import remains owner review.
