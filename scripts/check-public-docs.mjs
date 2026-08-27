#!/usr/bin/env node
import { access, readFile } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { syncPublicMessage, validatePublicMessage } from './lib/public-message.mjs';

const root = resolve(process.cwd());

async function read(relativePath) {
  return readFile(join(root, relativePath), 'utf8');
}

function requireText(text, expected, path) {
  if (!text.includes(expected)) {
    throw new Error(`${path} must contain: ${expected}`);
  }
}

function forbidText(text, forbidden, path) {
  if (text.includes(forbidden)) {
    throw new Error(`${path} still contains obsolete public copy: ${forbidden}`);
  }
}

async function assertExists(relativePath) {
  await access(join(root, relativePath));
}

function localManualTarget(fromPath, href) {
  const withoutFragment = href.split('#')[0].split('?')[0];
  if (!withoutFragment || withoutFragment.startsWith('http:') || withoutFragment.startsWith('https:')) {
    return null;
  }
  if (withoutFragment.startsWith('mailto:') || withoutFragment.startsWith('/assets/')) {
    return null;
  }
  if (withoutFragment.startsWith('/')) {
    const clean = withoutFragment.replace(/^\//, '').replace(/\/$/, '');
    if (!clean) {
      return 'docs/manual/index.md';
    }
    if (extname(clean)) {
      return `docs/manual/${clean}`;
    }
    return `docs/manual/${clean}.md`;
  }
  if (withoutFragment.startsWith('#')) {
    return null;
  }
  if (withoutFragment.endsWith('.md')) {
    return join(dirname(fromPath), withoutFragment);
  }
  return null;
}

async function checkLinks(relativePath, text) {
  const links = [...text.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)].map((match) => match[1]);
  for (const href of links) {
    const target = localManualTarget(relativePath, href);
    if (target) {
      await assertExists(target);
    }
  }
}

await syncPublicMessage(root, { write: false });

const publicMessage = validatePublicMessage(
  JSON.parse(await read('docs/publication/public-message.json'))
);
const readme = await read('README.md');
const agents = await read('AGENTS.md');
const claude = await read('CLAUDE.md');
const home = await read('docs/manual/index.md');
const grandDesign = await read('docs/manual/guide/grand-design.md');
const architecture = await read('docs/manual/guide/architecture.md');
const ontology = await read('docs/manual/guide/ontology.md');
const judgmentSystem = await read('docs/manual/guide/judgment-system.md');
const status = await read('docs/manual/guide/status.md');
const mcpTools = await read('docs/manual/reference/mcp-tools.md');
const versionHistory = await read('docs/manual/reference/version-history.md');
const cloudflare = await read('docs/manual/reference/cloudflare-pages.md');
const config = await read('docs/.vitepress/config.mjs');
const packageJson = JSON.parse(await read('package.json'));
const candidateSchema = JSON.parse(await read('contracts/public-message-candidate.schema.json'));
const docsWorkflow = await read('.github/workflows/docs-cloudflare-pages.yml');
const promotionWorkflow = await read('.github/workflows/public-message-promotion.yml');
const publicVerifier = await read('scripts/verify-public-site.mjs');

for (const [path, text] of [
  ['README.md', readme],
  ['docs/manual/index.md', home]
]) {
  requireText(text, publicMessage.copy.headline, path);
  requireText(text, publicMessage.copy.human_role, path);
  requireText(text, publicMessage.copy.ai_role, path);
}

requireText(grandDesign, publicMessage.copy.definition, 'docs/manual/guide/grand-design.md');
requireText(grandDesign, publicMessage.copy.human_role, 'docs/manual/guide/grand-design.md');
requireText(grandDesign, publicMessage.copy.ai_role, 'docs/manual/guide/grand-design.md');
requireText(judgmentSystem, publicMessage.copy.short_definition, 'docs/manual/guide/judgment-system.md');
requireText(judgmentSystem, publicMessage.copy.human_role, 'docs/manual/guide/judgment-system.md');
requireText(judgmentSystem, publicMessage.copy.ai_role, 'docs/manual/guide/judgment-system.md');

for (const [path, text] of [['AGENTS.md', agents], ['CLAUDE.md', claude]]) {
  requireText(text, 'This repository contains the OSS Brainbase judgment substrate', path);
  requireText(text, 'Promotion must create a PR', path);
  requireText(text, 'Do not stop at `ready: true`', path);
}

requireText(home, '判断の理由が残る', 'docs/manual/index.md');
requireText(home, '現在の実装を見る', 'docs/manual/index.md');
requireText(grandDesign, 'Brainbaseがない場合', 'docs/manual/guide/grand-design.md');
requireText(grandDesign, 'Brainbaseがある場合', 'docs/manual/guide/grand-design.md');
requireText(grandDesign, 'Personal Judgment', 'docs/manual/guide/grand-design.md');
requireText(architecture, '意味と事実の中核', 'docs/manual/guide/architecture.md');
requireText(architecture, 'resolve_entity', 'docs/manual/guide/architecture.md');
requireText(ontology, '会社の中にある人、組織、プロジェクト、判断', 'docs/manual/guide/ontology.md');
requireText(ontology, 'オントロジー、Graph、Judgment DAGの違い', 'docs/manual/guide/ontology.md');
requireText(judgmentSystem, 'オントロジーとGraphとの関係', 'docs/manual/guide/judgment-system.md');
requireText(judgmentSystem, 'Context / Observation', 'docs/manual/guide/judgment-system.md');
requireText(judgmentSystem, '重要なのは反証できること', 'docs/manual/guide/judgment-system.md');
requireText(status, 'Released — v0.4.0', 'docs/manual/guide/status.md');
requireText(status, 'Develop — release前', 'docs/manual/guide/status.md');
requireText(status, 'Planned — 未実装または未完成', 'docs/manual/guide/status.md');
requireText(status, 'Graphを直接Webへ表示しません', 'docs/manual/guide/status.md');
requireText(mcpTools, 'Ontology 2.0.0', 'docs/manual/reference/mcp-tools.md');
requireText(mcpTools, 'Graph v2', 'docs/manual/reference/mcp-tools.md');
requireText(mcpTools, 'resolve_entity', 'docs/manual/reference/mcp-tools.md');
requireText(versionHistory, '## 0.4.0', 'docs/manual/reference/version-history.md');
requireText(versionHistory, '## Unreleased — develop', 'docs/manual/reference/version-history.md');
requireText(cloudflare, 'CLOUDFLARE_ACCOUNT_ID', 'docs/manual/reference/cloudflare-pages.md');
requireText(cloudflare, 'Brainbase Graphから公開説明を昇格する', 'docs/manual/reference/cloudflare-pages.md');
requireText(config, "{ text: '現在の状態', link: '/guide/status' }", 'docs/.vitepress/config.mjs');
requireText(config, 'Build ${shortBuildSha}', 'docs/.vitepress/config.mjs');
await assertExists('docs/manual/public/assets/brainbase-grand-design.svg');
await assertExists('docs/manual/public/assets/brainbase-ontology.svg');

forbidText(readme, '# Brainbase 個人オンボーディングキット', 'README.md');
forbidText(home, '自分の仕事文脈をAIに渡すためのMCPマニュアル', 'docs/manual/index.md');
forbidText(config, "siteTitle: 'Brainbase Manual'", 'docs/.vitepress/config.mjs');

if (packageJson.description !== publicMessage.copy.package_description) {
  throw new Error('package.json description is not synchronized with public-message.json');
}
for (const script of [
  'docs:sync',
  'docs:check',
  'docs:smoke',
  'docs:verify-public',
  'docs:promotion:plan',
  'docs:promotion:apply'
]) {
  if (typeof packageJson.scripts?.[script] !== 'string') {
    throw new Error(`package.json is missing script ${script}`);
  }
}

if (candidateSchema.properties?.source?.properties?.type?.const !== 'brainbase_graph') {
  throw new Error('public-message candidate schema must require brainbase_graph source');
}
requireText(docsWorkflow, 'npm run docs:check', '.github/workflows/docs-cloudflare-pages.yml');
requireText(docsWorkflow, 'pages deploy docs/.vitepress/dist', '.github/workflows/docs-cloudflare-pages.yml');
requireText(docsWorkflow, 'npm run docs:verify-public', '.github/workflows/docs-cloudflare-pages.yml');
requireText(promotionWorkflow, 'brainbase-public-message-candidate', '.github/workflows/public-message-promotion.yml');
requireText(promotionWorkflow, 'npm run docs:promotion:plan', '.github/workflows/public-message-promotion.yml');
requireText(promotionWorkflow, 'gh pr create', '.github/workflows/public-message-promotion.yml');
requireText(publicVerifier, "path: '/guide/architecture'", 'scripts/verify-public-site.mjs');
requireText(publicVerifier, "path: '/guide/ontology'", 'scripts/verify-public-site.mjs');
requireText(publicVerifier, "path: '/assets/brainbase-grand-design.svg'", 'scripts/verify-public-site.mjs');
requireText(publicVerifier, "path: '/assets/brainbase-ontology.svg'", 'scripts/verify-public-site.mjs');

for (const path of [
  'docs/manual/index.md',
  'docs/manual/guide/grand-design.md',
  'docs/manual/guide/architecture.md',
  'docs/manual/guide/ontology.md',
  'docs/manual/guide/judgment-system.md',
  'docs/manual/guide/status.md',
  'docs/manual/reference/cloudflare-pages.md',
  'docs/manual/reference/version-history.md'
]) {
  await checkLinks(path, await read(path));
}

process.stdout.write(`${JSON.stringify({
  status: 'public_docs_valid',
  candidate_id: publicMessage.candidate_id,
  checked_pages: 8,
  checked_workflows: 2
}, null, 2)}\n`);
