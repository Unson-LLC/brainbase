#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const root = resolve(process.cwd());
const dist = join(root, 'docs/.vitepress/dist');

async function read(relativePath) {
  return readFile(join(dist, relativePath), 'utf8');
}

function requireText(text, expected, path) {
  if (!text.includes(expected)) {
    throw new Error(`${path} must contain: ${expected}`);
  }
}

const index = await read('index.html');
const grandDesign = await read('guide/grand-design.html');
const judgmentSystem = await read('guide/judgment-system.html');
const status = await read('guide/status.html');
const mcpTools = await read('reference/mcp-tools.html');

requireText(index, '会社の判断を、属人化させない。', 'index.html');
requireText(index, 'Brainbaseを理解する', 'index.html');
requireText(grandDesign, 'Brainbaseがある場合', 'guide/grand-design.html');
requireText(judgmentSystem, '重要なのは反証できること', 'guide/judgment-system.html');
requireText(status, 'Released — v0.4.0', 'guide/status.html');
requireText(status, 'Planned — 未実装または未完成', 'guide/status.html');
requireText(mcpTools, 'Ontology 2.0.0', 'reference/mcp-tools.html');
requireText(mcpTools, 'resolve_entity', 'reference/mcp-tools.html');

if (index.includes('自分の仕事文脈をAIに渡すためのMCPマニュアル')) {
  throw new Error('index.html contains the obsolete product definition');
}

const expectedSha = process.env.GITHUB_SHA ?? process.env.CF_PAGES_COMMIT_SHA;
if (expectedSha) {
  requireText(index, expectedSha.slice(0, 12), 'index.html');
}

process.stdout.write(`${JSON.stringify({
  status: 'built_docs_valid',
  pages: [
    'index.html',
    'guide/grand-design.html',
    'guide/judgment-system.html',
    'guide/status.html',
    'reference/mcp-tools.html'
  ]
}, null, 2)}\n`);
