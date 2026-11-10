import type { KnownBlock, ModalView, PlainTextElement } from '@slack/types';
import type { Ticket } from './tickets';
import { triage, formatReply, escapeSlack } from './triage';
const plain = (text: string): PlainTextElement => ({ type: 'plain_text', text });
export function ticketCard(ticket: Ticket) {
	const overview = `${ticket.id}\nStatus: ${ticket.status} | Priority: ${ticket.priority}\nOwner: ${ticket.assignee ?? 'unassigned'} | Requester: ${ticket.requester}`;
	const decision = triage(ticket.text);
	const evidence = formatReply(
		ticket.status === 'escalated'
			? { ...decision, action: 'escalate', route: 'Support Lead', reason: 'A participant requested human review.' }
			: decision,
	).replace(
		'Human handoff (prepared here; no ticket or page created):',
		'Human handoff for this persisted request (no external page sent):',
	);
	const blocks: KnownBlock[] = [
		{ type: 'header', text: plain('Caetano-Help · Support request') },
		{ type: 'section', text: plain(overview) },
		{ type: 'section', text: plain(`Request: ${ticket.text}`) },
		{ type: 'section', text: plain(evidence) },
	];
	if (ticket.status !== 'resolved')
		blocks.push({
			type: 'actions',
			elements: [
				['claim', 'Take ownership'],
				['escalate', 'Need human review'],
				['resolve', 'Mark resolved'],
			].map(([action, label]) => ({
				type: 'button' as const,
				text: plain(label),
				action_id: `ticket_${action}`,
				value: `${ticket.id}|${ticket.version}`,
			})),
		});
	return {
		text: `${overview}\nRequest: ${escapeSlack(decision.summary)}\n${evidence}`,
		blocks,
		mrkdwn: false,
		parse: 'none',
		unfurl_links: false,
		unfurl_media: false,
	};
}
export function intakeModal(context: { team: string; channel: string; requester: string }): ModalView {
	return {
		type: 'modal',
		callback_id: 'support_intake',
		title: plain('AI support request'),
		submit: plain('Create request'),
		close: plain('Cancel'),
		private_metadata: JSON.stringify(context),
		blocks: [
			{
				type: 'section',
				text: plain('Fictional demo. Include the AI tool, observed behavior and expected outcome. Use synthetic/redacted data only.'),
			},
			{
				type: 'input',
				block_id: 'details',
				label: plain('What do you need help with?'),
				element: { type: 'plain_text_input', action_id: 'value', multiline: true, min_length: 10, max_length: 2000 },
			},
			{
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
			},
		],
	};
}
export const helpText =
	'/caetano new — open a support form\n/caetano list — your last 10 requests in this channel\n/caetano queue — support-only channel queue\n/caetano status CH-… — status and audit history\nMention the bot for quick runbook triage. Use fictional data only.';
