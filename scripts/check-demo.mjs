import assert from 'node:assert/strict';
import { writeFile, mkdir } from 'node:fs/promises';
const target = await (await fetch('http://127.0.0.1:9222/json/new?http://127.0.0.1:4173', { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let next = 0;
const pending = new Map();
ws.addEventListener('message', (e) => {
	const m = JSON.parse(e.data);
	if (m.id) {
		pending.get(m.id)?.(m);
		pending.delete(m.id);
	}
});
const send = (method, params = {}) =>
	new Promise((resolve) => {
		const id = ++next;
		pending.set(id, resolve);
		ws.send(JSON.stringify({ id, method, params }));
	});
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
let ready = false;
for (let i = 0; i < 50; i++) {
	const r = await send('Runtime.evaluate', { expression: 'document.getElementById("payload")?.textContent', returnByValue: true });
	if (r.result?.result?.value?.includes('RB-ACCESS')) {
		ready = true;
		break;
	}
	await new Promise((r) => setTimeout(r, 100));
}
assert(ready, 'initial card did not render');
await send('Runtime.evaluate', { expression: 'document.getElementById("examples").focus()' });
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
const focus = await send('Runtime.evaluate', { expression: 'document.activeElement.id', returnByValue: true });
assert.equal(focus.result.result.value, 'request');
const result = await send('Runtime.evaluate', {
	expression: `(()=>{const s=document.getElementById('examples');s.value='integration-rate';s.dispatchEvent(new Event('change'));return {decision:document.getElementById('decision').textContent,card:document.getElementById('card').textContent}})()`,
	returnByValue: true,
});
assert.match(result.result.result.value.decision, /integration/);
assert.match(result.result.result.value.card, /Retry-After/);
const malicious = await send('Runtime.evaluate', {
	expression: `(()=>{document.getElementById('request').value='<img src=x onerror="window.injected=true"> Atlas AI leaked data';document.getElementById('run').click();return {injected:!!window.injected,images:document.querySelectorAll('#card img').length,text:document.getElementById('card').textContent}})()`,
	returnByValue: true,
});
assert.equal(malicious.result.result.value.injected, false);
assert.equal(malicious.result.result.value.images, 0);
assert.match(malicious.result.result.value.text, /Human handoff/);
await send('Runtime.evaluate', {
	expression: `document.activeElement.blur();document.getElementById('examples').value='integration-rate';document.getElementById('examples').dispatchEvent(new Event('change'))`,
});
const images = new URL('../docs/images/', import.meta.url);
await mkdir(images, { recursive: true });
const screenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
await writeFile(new URL('offline-demo.png', images), Buffer.from(screenshot.result.data, 'base64'));
await send('Emulation.setDeviceMetricsOverride', { width: 320, height: 800, deviceScaleFactor: 1, mobile: true });
const mobile = await send('Runtime.evaluate', {
	expression: 'window.innerWidth === 320 && document.documentElement.scrollWidth <= 320',
	returnByValue: true,
});
assert.equal(mobile.result.result.value, true);
console.log('Browser checks passed: initial render, keyboard navigation, scenario switching, custom input escaping, mobile overflow, screenshot.');
ws.close();
