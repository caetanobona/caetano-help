const encoder = new TextEncoder();

export async function verifySlackRequest(request: Request, rawBody: string, signingSecret: string): Promise<boolean> {
	const timestamp = request.headers.get('X-Slack-Request-Timestamp');
	const signature = request.headers.get('X-Slack-Signature');

	if (!timestamp || !/^\d+$/.test(timestamp)) {
		return false;
	}

	if (!signature || !/^v0=[0-9a-f]{64}$/.test(signature)) {
		return false;
	}

	// A janela de cinco minutos limita o reaproveitamento de pedidos antigos.
	const ageInSeconds = Math.abs(Date.now() / 1000 - Number(timestamp));
	if (ageInSeconds > 300) {
		return false;
	}

	const key = await crypto.subtle.importKey('raw', encoder.encode(signingSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);

	// O Slack envia o HMAC em hexadecimal. Web Crypto recebe os bytes.
	const signatureBytes = new Uint8Array(32);
	for (let index = 0; index < signatureBytes.length; index++) {
		const offset = 3 + index * 2; // Pula o prefixo "v0=".
		signatureBytes[index] = Number.parseInt(signature.slice(offset, offset + 2), 16);
	}

	return crypto.subtle.verify('HMAC', key, signatureBytes, encoder.encode(`v0:${timestamp}:${rawBody}`));
}
