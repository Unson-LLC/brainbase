import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const vendorPath = resolve(repoRoot, 'ui/project-graph-vendor.js');
const licensePath = resolve(repoRoot, 'ui/project-graph-vendor.LICENSE.txt');

// Keep Sigma and graphology local to the application bundle.  The browser
// entry imports this file, so production never depends on a CDN or a runtime
// package resolver.
await build({
  stdin: {
    contents: [
      "import Sigma from 'sigma';",
      "import { MultiDirectedGraph } from 'graphology';",
      'export { Sigma, MultiDirectedGraph };',
    ].join('\n'),
    resolveDir: repoRoot,
    sourcefile: 'project-graph-vendor.virtual.js',
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

const bundledLicenses = [
  ['sigma 3.0.3', 'node_modules/sigma/LICENSE.txt'],
  ['graphology 0.26.0', 'node_modules/graphology/LICENSE.txt'],
  ['graphology-utils 2.5.2', 'node_modules/graphology-utils/LICENSE.txt'],
  ['graphology-types 0.24.8', 'node_modules/graphology-types/LICENSE.txt'],
  ['events 3.3.0', 'node_modules/events/LICENSE'],
];
const licenseTexts = await Promise.all(
  bundledLicenses.map(async ([name, relativePath]) => `${name} (MIT)\n${(await readFile(resolve(repoRoot, relativePath), 'utf8')).trim()}`),
);

await writeFile(
  licensePath,
  [
    'Third-party licenses bundled in ui/project-graph-vendor.js',
    '',
    ...licenseTexts.flatMap((text) => [text, '']),
    '',
  ].join('\n'),
  'utf8',
);

console.log(`Built ${vendorPath}`);
