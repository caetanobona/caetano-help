# Fictional runbooks

All products, teams and procedures below are invented for this portfolio demo.
They are not instructions for any real service. The runtime corpus lives in
`src/runbooks.ts`; IDs below are the references shown in Slack.

## RB-ACCESS

**Atlas AI / Orbit AI access — owner: Identity & Access**

For Atlas AI and Orbit AI, verify the approved workspace and assigned seat with Identity & Access. For SSO failures, record the error code and UTC timestamp; never share passwords or session tokens.

## RB-INTEGRATION

**Atlas AI / Orbit AI integration failures — owner: Integration Engineering**

For Atlas AI and Orbit AI integrations, collect the HTTP status, redacted request ID and UTC timestamp. For 429, honor Retry-After and use bounded backoff. Retry only idempotent operations; escalate repeated timeouts or 5xx errors to Integration Engineering.

## RB-USECASE

**Atlas AI / Orbit AI pilot intake — owner: AI Enablement**

For an Atlas AI or Orbit AI pilot, define one workflow, an owner and a measurable success criterion. Start with synthetic data, evaluate outputs against labeled examples and require human review before expanding access.
