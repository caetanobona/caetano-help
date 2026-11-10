import { afterEach, expect, it, vi } from 'vitest';
import { slackApi } from '../src/slack-api';
afterEach(() => vi.restoreAllMocks());
it('actually aborts a nonresponding Slack transport before three seconds', async () => {
	const log = vi.spyOn(console, 'error').mockImplementation(() => {});
	vi.spyOn(globalThis, 'fetch').mockImplementation(
		(_url, init) =>
			new Promise((_resolve, reject) => {
				init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
			}),
	);
	const start = Date.now();
	expect(await slackApi('fake', 'views.open', {})).toBeNull();
	expect(Date.now() - start).toBeGreaterThanOrEqual(2400);
	expect(Date.now() - start).toBeLessThan(4000);
	expect(log).toHaveBeenCalledWith('Slack API failed', { code: 'transport_error' });
}, 6000);
it('rejects Slack JSON errors without leaking upstream strings', async () => {
	const log = vi.spyOn(console, 'error').mockImplementation(() => {});
	vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ ok: false, error: 'fake-private-value' }));
	expect(await slackApi('fake', 'chat.postMessage', {})).toBeNull();
	expect(JSON.stringify(log.mock.calls)).not.toContain('fake-private-value');
});
