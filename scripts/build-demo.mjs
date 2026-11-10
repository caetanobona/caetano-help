// Uses the repository's declared TypeScript dev dependency; no CDN or runtime API.
import ts from 'typescript';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
const out = new URL('../dist/demo/', import.meta.url);
await mkdir(out, { recursive: true });
await writeFile(new URL('package.json', out), JSON.stringify({ type: 'module' }));
for (const name of ['runbooks', 'triage', 'slack-ui']) {
	const source = await readFile(new URL(`../src/${name}.ts`, import.meta.url), 'utf8');
	const compiled = ts
		.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } })
		.outputText.replace(/from ['"]\.\/(runbooks|triage)['"]/g, (_, name) => `from './${name}.js'`);
	await writeFile(new URL(`${name}.js`, out), compiled);
}
const samples = await readFile(new URL('../test/fixtures/triage-cases.ts', import.meta.url), 'utf8');
await writeFile(new URL('cases.js', out), ts.transpileModule(samples, { compilerOptions: { module: ts.ModuleKind.ES2022 } }).outputText);
await writeFile(new URL('index.html', out), await readFile(new URL('./demo.html', import.meta.url), 'utf8'));
console.log('Offline demo built in dist/demo. Serve with: python3 -m http.server 4173 --directory dist/demo --bind 127.0.0.1');
