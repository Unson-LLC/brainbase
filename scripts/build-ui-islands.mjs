import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';
mkdirSync('public/dist', { recursive: true });
await build({
  entryPoints: ['ui-islands/session-list/index.jsx'],
  bundle: true,
  minify: true,
  format: 'esm',
  jsx: 'automatic',
  // The app's own runtime modules are imported live (shared singletons), not bundled.
  external: ['/modules/*'],
  define: { 'process.env.NODE_ENV': '"production"' },
  outfile: 'public/dist/session-list-island.js',
});
console.log('built public/dist/session-list-island.js');
