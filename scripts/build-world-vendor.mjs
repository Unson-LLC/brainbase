import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const vendorPath = resolve(repoRoot, 'ui/world/world-vendor.js');
const licensePath = resolve(repoRoot, 'ui/world/world-vendor.LICENSE.txt');

// Experimental world view (W1–W4, provisional). Like the project graph, three.js
// is bundled into the application so the page never loads a CDN.
await build({
  stdin: {
    contents: [
      "export * as THREE from 'three';",
      "export { MapControls } from 'three/examples/jsm/controls/MapControls.js';",
    ].join('\n'),
    resolveDir: repoRoot,
    sourcefile: 'world-vendor.virtual.js',
    loader: 'js',
  },
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  legalComments: 'none',
  minify: true,
  outfile: vendorPath,
});

const pkg = JSON.parse(await readFile(resolve(repoRoot, 'node_modules/three/package.json'), 'utf8'));
const license = await readFile(resolve(repoRoot, 'node_modules/three/LICENSE'), 'utf8');
await writeFile(licensePath, `three ${pkg.version}\n\n${license.trim()}\n`);
