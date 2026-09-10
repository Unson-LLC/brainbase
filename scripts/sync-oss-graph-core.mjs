#!/usr/bin/env node
// Explicitly vendor the public OSS kernel; no organization source is exported.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = process.argv[2];
if (!source) throw new Error('Usage: node scripts/sync-oss-graph-core.mjs <built OSS checkout>');
const modules = ['portable-graph', 'graph-retrieval', 'canonical-graph', 'relation-registry', 'embedding-provider'];
execFileSync('git', ['-C', resolve(source), 'diff', '--exit-code', 'HEAD', '--', ...modules.map(name => `src/${name}.ts`)], { stdio: 'pipe' });
execFileSync(process.execPath, [resolve(source, 'node_modules/typescript/bin/tsc'), '-p', resolve(source, 'tsconfig.json')], { stdio: 'pipe' });
const target = resolve(root, 'vendor/brainbase-oss-graph');
await mkdir(target, { recursive: true });
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const files = {};
for (const name of modules) {
  const code = await readFile(resolve(source, `dist/${name}.js`));
  const sourceBytes = await readFile(resolve(source, `src/${name}.ts`));
  for (const match of code.toString().matchAll(/from ['"]([^'"]+)['"]/g)) {
    if (match[1] !== 'node:crypto' && !modules.some(m => match[1] === `./${m}.js`)) {
      throw new Error(`Unexpected kernel dependency: ${match[1]}`);
    }
  }
  await writeFile(resolve(target, `${name}.js`), code);
  files[`${name}.js`] = { sha256: hash(code), source_sha256: hash(sourceBytes) };
}
await writeFile(resolve(target, 'LICENSE'), await readFile(resolve(source, 'LICENSE')));
await writeFile(resolve(target, 'source-lock.json'), JSON.stringify({
  repository: 'https://github.com/Unson-LLC/brainbase',
  source_commit: execFileSync('git', ['-C', resolve(source), 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  files
}, null, 2) + '\n');
