#!/usr/bin/env node
/*
 * Bounded browser harness for UX-06.
 *
 * This serves the real local Web shell and UI modules with synthetic, in-memory
 * responses only.  It deliberately does not read a judgment journal, Graph
 * directory, or user data.  Use it for Inspector's P1 x S1 walkthrough only;
 * it is not a local Web host or a deployment command.
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import {
  graphEntityPayload,
  sourceBearingHome,
  UX06_GRAPH_ENTITY,
  UX06_GRAPH_ONTOLOGY,
  UX06_GRAPH_SEARCH,
} from './ux06-source-fixture.mjs';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, '../..');
const UI_ROOT = join(REPO_ROOT, 'ui');
const FIXTURE_STATUS = Object.freeze({
  version: 'local-web-host.v1',
  data_dir: '/synthetic/ux06-personal-web',
  journal_root: '/synthetic/ux06-personal-web/judgment-journal',
  graph: { status: 'ready', format: 'v2', commands: [] },
});

const INDEX_HTML = `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>UX-06 出典遷移 fixture</title>
    <link rel="stylesheet" href="/ui/brainbase-tokens.css">
    <link rel="stylesheet" href="/ui/workspace-kit.css">
    <link rel="stylesheet" href="/ui/local-web-shell.css">
    <link rel="stylesheet" href="/ui/value-proof-review.css">
    <link rel="stylesheet" href="/ui/graph-view-shared.css">
    <link rel="stylesheet" href="/ui/graph-registry-view.css">
    <link rel="stylesheet" href="/ui/graph-projects-view.css">
  </head>
  <body>
    <p style="margin:0;padding:8px 16px;background:#fff8e6;color:#694d00">UX-06 synthetic fixture（架空データ・実journal不使用）</p>
    <div id="app"></div>
    <script type="module" src="/fixture-entry.js"></script>
  </body>
</html>`;

const ENTRY_MODULE = `import { createLocalWebShell } from '/ui/local-web-shell.js';

const root = document.querySelector('#app');
const target = () => window.location.hash.replace(/^#/, '') || 'today';
const shell = createLocalWebShell({ root, initialScreen: target() });
window.__ux06Fixture = shell;
window.addEventListener('hashchange', () => shell.show(target()));
`;

function json(response, status, payload) {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.end(JSON.stringify(payload));
}

function text(response, status, body, contentType) {
  response.statusCode = status;
  response.setHeader('Content-Type', contentType);
  response.end(body);
}

function contentType(pathname) {
  if (pathname.endsWith('.css')) return 'text/css; charset=utf-8';
  if (pathname.endsWith('.js')) return 'text/javascript; charset=utf-8';
  return 'application/octet-stream';
}

async function serveUi(pathname, response) {
  const filename = pathname.slice('/ui/'.length);
  // UI files are served by basename only; this fixture never exposes paths
  // outside the checked-in `ui` directory.
  if (!filename || filename.includes('/') || filename.includes('\\') || !/^[A-Za-z0-9._-]+$/.test(filename)) {
    text(response, 404, 'not found', 'text/plain; charset=utf-8');
    return;
  }
  try {
    text(response, 200, await readFile(join(UI_ROOT, filename)), contentType(filename));
  } catch {
    text(response, 404, 'not found', 'text/plain; charset=utf-8');
  }
}

async function handleRequest(request, response) {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  if (request.method !== 'GET') {
    text(response, 405, 'method not allowed', 'text/plain; charset=utf-8');
    return;
  }
  if (url.pathname === '/' || url.pathname === '/index.html') {
    text(response, 200, INDEX_HTML, 'text/html; charset=utf-8');
    return;
  }
  if (url.pathname === '/fixture-entry.js') {
    text(response, 200, ENTRY_MODULE, 'text/javascript; charset=utf-8');
    return;
  }
  if (url.pathname.startsWith('/ui/')) {
    await serveUi(url.pathname, response);
    return;
  }
  if (url.pathname === '/api/local/status') {
    json(response, 200, FIXTURE_STATUS);
    return;
  }
  if (url.pathname === '/api/value-proofs/home') {
    json(response, 200, sourceBearingHome());
    return;
  }
  if (url.pathname === '/api/graph/search') {
    json(response, 200, UX06_GRAPH_SEARCH);
    return;
  }
  if (url.pathname === '/api/graph/ontology') {
    json(response, 200, UX06_GRAPH_ONTOLOGY);
    return;
  }
  if (url.pathname === `/api/graph/entities/${encodeURIComponent(UX06_GRAPH_ENTITY.id)}`) {
    json(response, 200, graphEntityPayload());
    return;
  }
  if (url.pathname.startsWith('/api/')) {
    json(response, 404, { error: { code: 'not_found', message: 'fixture route not found' } });
    return;
  }
  text(response, 404, 'not found', 'text/plain; charset=utf-8');
}

export function createUx06FixtureServer() {
  return createServer((request, response) => {
    void handleRequest(request, response).catch(() => {
      if (!response.headersSent) json(response, 500, { error: { code: 'fixture_error' } });
      else response.end();
    });
  });
}

function optionValue(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  const value = Number(process.argv[index + 1]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

async function main() {
  const port = optionValue('--port', 31986);
  const durationSeconds = optionValue('--duration', 900);
  const server = createUx06FixtureServer();
  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolveListen);
  });
  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : port;
  const close = () => new Promise((resolveClose) => server.close(resolveClose));
  const timer = setTimeout(async () => {
    await close();
    process.exitCode = 0;
  }, durationSeconds * 1000);
  const stop = async () => {
    clearTimeout(timer);
    await close();
  };
  process.once('SIGINT', () => void stop().finally(() => process.exit(0)));
  process.once('SIGTERM', () => void stop().finally(() => process.exit(0)));
  console.log(`UX-06 synthetic fixture: http://127.0.0.1:${actualPort}/#today`);
  console.log(`期限: ${durationSeconds}秒。実journal・実Graphは読みません。`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
