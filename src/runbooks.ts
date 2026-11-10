export type SupportedCategory = 'access' | 'integration' | 'use_case';
export interface Runbook {
	id: string;
	title: string;
	path: string;
	category: SupportedCategory;
	excerpt: string;
}

// Entirely fictional, reviewed demo corpus. No customer or employer data.
export const runbooks: readonly Runbook[] = [
	{
		id: 'RB-ACCESS',
		title: 'Atlas AI / Orbit AI access',
		path: 'docs/runbooks.md#rb-access',
		category: 'access',
		excerpt:
			'For Atlas AI and Orbit AI, verify the approved workspace and assigned seat with Identity & Access. For SSO failures, record the error code and UTC timestamp; never share passwords or session tokens.',
	},
	{
		id: 'RB-INTEGRATION',
		title: 'Atlas AI / Orbit AI integration failures',
		path: 'docs/runbooks.md#rb-integration',
		category: 'integration',
		excerpt:
			'For Atlas AI and Orbit AI integrations, collect the HTTP status, redacted request ID and UTC timestamp. For 429, honor Retry-After and use bounded backoff. Retry only idempotent operations; escalate repeated timeouts or 5xx errors to Integration Engineering.',
	},
	{
		id: 'RB-USECASE',
		title: 'Atlas AI / Orbit AI pilot intake',
		path: 'docs/runbooks.md#rb-usecase',
		category: 'use_case',
		excerpt:
			'For an Atlas AI or Orbit AI pilot, define one workflow, an owner and a measurable success criterion. Start with synthetic data, evaluate outputs against labeled examples and require human review before expanding access.',
	},
];
