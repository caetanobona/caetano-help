import { triage } from '../dist/demo/triage.js';
import { cases } from '../dist/demo/cases.js';
const results = cases.map((c) => {
	const r = triage(c.text);
	return {
		id: c.id,
		expected: c.category,
		predicted: r.category,
		category: r.category === c.category,
		route: r.route === c.route,
		action: r.action === c.action,
		sources: JSON.stringify(r.sources.map((s) => s.id)) === JSON.stringify(c.sources),
	};
});
const metrics = Object.fromEntries(
	['category', 'route', 'action', 'sources'].map((key) => [key, { correct: results.filter((r) => r[key]).length, total: results.length }]),
);
const byCategory = Object.fromEntries(
	[...new Set(cases.map((c) => c.category))].map((category) => {
		const rows = results.filter((r) => r.expected === category);
		return [category, { correct: rows.filter((r) => r.category).length, total: rows.length }];
	}),
);
console.log(
	JSON.stringify(
		{
			dataset: 'synthetic development regression set, not held out',
			metrics,
			byCategory,
			failures: results.filter((r) => !r.category || !r.route || !r.action || !r.sources),
		},
		null,
		2,
	),
);
if (results.some((r) => !r.category || !r.route || !r.action || !r.sources)) process.exitCode = 1;
