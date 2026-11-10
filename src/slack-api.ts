export type SlackMethod = 'chat.postMessage' | 'chat.postEphemeral' | 'views.open';
export async function slackApi(token: string, method: SlackMethod, body: unknown): Promise<Record<string, unknown> | null> {
	try {
		const response = await fetch(`https://slack.com/api/${method}`, {
			method: 'POST',
			signal: AbortSignal.timeout(2500),
			headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
			body: JSON.stringify(body),
		});
		if (!response.ok) {
			console.error('Slack API failed', { code: 'http_error' });
			return null;
		}
		const result: unknown = await response.json();
		if (!result || typeof result !== 'object' || !('ok' in result) || result.ok !== true) {
			console.error('Slack API failed', { code: 'api_error' });
			return null;
		}
		return result as Record<string, unknown>;
	} catch {
		console.error('Slack API failed', { code: 'transport_error' });
		return null;
	}
}
