import type { KnownBlock, ModalView, MrkdwnElement, PlainTextElement } from '@slack/types';
import type { Ticket } from './tickets';
import { triage, escapeSlack } from './triage';
const plain = (text: string): PlainTextElement => ({ type: 'plain_text', text });
const formatted = (text: string): MrkdwnElement => ({ type: 'mrkdwn', text, verbatim: true });
const statusLabels: Record<Ticket['status'], string> = {
	open: 'Open',
	in_progress: 'In progress',
	escalated: 'Awaiting human review',
	resolved: 'Resolved',
};
const statusIcons: Record<Ticket['status'], string> = {
	open: '💬',
	in_progress: '🛠️',
	escalated: '👥',
	resolved: '✅',
};

export function ticketCard(ticket: Ticket) {
	const decision = triage(ticket.text);
	const status = statusLabels[ticket.status];
	const impact = ticket.priority === 'high' ? 'High' : 'Normal';
	const assignment = ticket.assignee ? 'Assigned to support' : 'Unassigned';
	const review = ticket.status === 'escalated' || decision.action === 'escalate';
	const sources = decision.sources.map((source) => `${source.title} (${source.id})`).join(' · ');
	const label =
		ticket.status === 'resolved' ? 'Request closed'
			: review ? 'Human handoff · Support Lead'
			: decision.question ? 'More information needed'
			: 'Suggested next step';
	const nextStep =
		ticket.status === 'resolved'
			? 'This request is closed. Open a new request if you need more help.'
			: review
				? [
						ticket.status === 'escalated' ? 'Marked for human review.' : 'Human review recommended.',
						`Reported impact: ${decision.impact}`,
						'Missing: confirmed scope, redacted error or request ID, and UTC timestamp.',
						'Ask a support teammate to review this thread. No one was notified automatically.',
					].join('\n')
				: decision.question ?? decision.sources.map((source) => source.excerpt).join('\n\n');
	const blocks: KnownBlock[] = [
		{ type: 'header', text: plain('Support request') },
		{ type: 'context', elements: [formatted(`${statusIcons[ticket.status]} *${status}* · ${impact} impact · ${assignment}`)] },
		{ type: 'section', text: formatted(`*${label}*\n${escapeSlack(nextStep)}`) },
	];
	if (ticket.status !== 'resolved')
		blocks.push({
			type: 'actions',
			elements: [
				...(!review && decision.question ? [['details', 'Add details']] : []),
				...(ticket.status === 'in_progress' ? [] : [['claim', 'Take ownership']]),
				['escalate', 'Need human review'],
				['resolve', 'Resolve request'],
			].map(([action, label]) => ({
				type: 'button' as const,
				text: plain(label),
				action_id: `ticket_${action}`,
				value: `${ticket.id}|${ticket.version}`,
				...(action === 'details' || (action === 'escalate' && review && ticket.status !== 'escalated') ? { style: 'primary' as const } : {}),
			})),
		});
	const request = ticket.text.replace(/<@[A-Z0-9]+>/gi, '').trim() || decision.summary;
	blocks.push(
		{ type: 'divider' },
		{ type: 'section', text: plain(`Request: ${request}`) },
		{ type: 'context', elements: [plain(`Ticket ID: ${ticket.id}`), ...(sources ? [plain(`Runbook: ${sources}`)] : [])] },
	);
	return {
		text: escapeSlack([
			`Support request · ${status}`,
			label,
			nextStep,
			`Impact: ${impact} · ${assignment}`,
			`Request: ${decision.summary}`,
			`Ticket ID: ${ticket.id}`,
			...(sources ? [`Runbook: ${sources}`] : []),
		].join('\n')),
		blocks,
		mrkdwn: false,
		parse: 'none',
		unfurl_links: false,
		unfurl_media: false,
	};
}
export function intakeModal(context: {
	team: string;
	channel: string;
	requester: string;
	sourceMessage?: { ts: string; threadTs: string };
	ticket?: { id: string; version: number };
}, initialValue?: string): ModalView {
	const updating = !!context.ticket;
	return {
		type: 'modal',
		callback_id: updating ? 'support_details' : 'support_intake',
		title: plain(updating ? 'Add request details' : 'Open a support request'),
		submit: plain(updating ? 'Save details' : 'Create request'),
		close: plain('Cancel'),
		private_metadata: JSON.stringify(context),
		blocks: [
			{
				type: 'section',
				text: plain(updating
					? 'Update the description with the missing information. Your changes will be posted in the original thread. Leave out credentials and customer data.'
					: context.sourceMessage
						? 'Review and redact the selected message before creating a ticket in its thread. Leave out credentials and customer data.'
						: 'Your request will be posted in this channel. This is a demo. Use fictional or redacted details and leave out credentials and customer data.'),
			},
			{
				type: 'input',
				block_id: 'details',
				label: plain('What do you need help with?'),
				element: {
					type: 'plain_text_input',
					action_id: 'value',
					placeholder: plain('Atlas AI rejects my SSO login. I expected to reach the dashboard.'),
					...(initialValue ? { initial_value: initialValue.slice(0, 2000) } : {}),
					multiline: true,
					min_length: 10,
					max_length: 2000,
				},
			},
			...(!updating ? [{
				type: 'input',
				block_id: 'priority',
				label: plain('Reported impact'),
				element: {
					type: 'static_select',
					action_id: 'value',
					initial_option: { text: plain('Normal — individual request'), value: 'normal' },
					options: [
						{ text: plain('Normal — individual request'), value: 'normal' },
						{ text: plain('High — broad impact'), value: 'high' },
					],
				},
			} satisfies KnownBlock] : []),
		],
	};
}
export const helpText =
	'Caetano-Help · AI support\n\nOpen a request: /caetano-help new\nSee your requests in this channel: /caetano-help list\nCheck a ticket or get its latest card: /caetano-help status CH-…\n\nFor support teammates: /caetano-help queue\n\nYou can also mention Caetano-Help with a brief description. Use fictional or redacted details.';
