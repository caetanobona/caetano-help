import { runbooks, type Runbook, type SupportedCategory } from './runbooks';

export type Category = SupportedCategory | 'ambiguous' | 'unknown' | 'out_of_scope';
export interface TriageResult {
	category: Category;
	route: string;
	action: 'guide' | 'clarify' | 'escalate';
	summary: string;
	impact: string;
	reason: string;
	question?: string;
	sources: readonly Runbook[];
}
const routes: Record<SupportedCategory, string> = {
	access: 'Identity & Access',
	integration: 'Integration Engineering',
	use_case: 'AI Enablement',
};
const signals: Record<SupportedCategory, RegExp> = {
	access: /\b(login|sso|permission|permissions|seat|license|access|acessar|acesso|permissao|licenca)\b/,
	integration: /\b(api|webhook|integration|integracao|timeout|429|500|502|503|oauth|sync)\b/,
	use_case: /\b(use case|use cases|summarize|summary|summaries|automatizar|automate|pilot|resumo|resumos)\b/,
};

// Lexical retrieval over a deliberately small corpus, not semantic search or RAG.
export function triage(text: string): TriageResult {
	const summary = text
		.replace(/<@[A-Z0-9]+>/gi, '')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, 280);
	const query = summary
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase();
	const matches = (Object.keys(signals) as SupportedCategory[]).filter((key) => signals[key].test(query));
	const category: Category =
		matches.length > 1
			? 'ambiguous'
			: matches.length === 1
				? matches[0]
				: /\b(weather|pizza|payroll|tempo amanha)\b/.test(query)
					? 'out_of_scope'
					: 'unknown';
	const supported = category === 'access' || category === 'integration' || category === 'use_case';
	const knownTool = /\b(atlas ai|orbit ai)\b/.test(query);
	const incident = /\b(all users|everyone|todos|outage|leak|leaked|vazamento|exposed|breach)\b/.test(query);
	const sources = supported && knownTool ? runbooks.filter((book) => book.category === category) : [];
	const result: TriageResult = {
		category,
		route: supported ? routes[category] : 'Support Lead',
		action: 'guide',
		summary: summary || '(no request details)',
		impact: incident ? 'Potential broad impact or sensitive-data incident; unverified.' : 'Not yet confirmed.',
		reason: 'Matched a fictional runbook by request category and supported tool.',
		sources,
	};
	if (incident || category === 'out_of_scope') {
		return {
			...result,
			action: 'escalate',
			route: 'Support Lead',
			reason: incident
				? 'Human assessment required for reported impact or sensitive-data risk.'
				: 'Outside the AI-tool support demo scope.',
		};
	}
	if (!sources.length) {
		return {
			...result,
			action: 'clarify',
			reason: 'Insufficient evidence for a supported remediation.',
			question:
				category === 'ambiguous'
					? 'Which issue should we triage first: access, integration, or the new use case?'
					: supported && !knownTool
						? 'Which AI tool and workspace are affected?'
						: 'Which AI tool is involved and what exact behavior did you expect versus observe?',
		};
	}
	return result;
}

export function escapeSlack(text: string): string {
	return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function formatReply(result: TriageResult): string {
	const lines = [
		'Fictional demo — deterministic runbook triage',
		`Category: ${result.category} | Route: ${result.route}`,
		`Action: ${result.action}`,
		result.reason,
	];
	if (result.action === 'escalate') {
		lines.push(
			'Human handoff (prepared here; no ticket or page created):',
			`Request: ${result.summary}`,
			`Impact: ${result.impact}`,
			'Missing: confirmed scope, redacted error/request ID and UTC timestamp.',
			'Next: a human must verify impact and choose the response. Do not share credentials or customer data.',
		);
	}
	if (result.question) lines.push(result.question);
	if (result.sources.length) {
		lines.push('Retrieved evidence (fictional):');
		for (const source of result.sources) {
			lines.push(`[${source.id}] ${source.title} (${source.path})`, source.excerpt);
		}
	} else {
		lines.push('Sources: none — no supported runbook evidence. No remediation asserted.');
	}
	return escapeSlack(lines.join('\n'));
}
