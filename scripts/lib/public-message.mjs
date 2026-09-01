import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

export const PUBLIC_MESSAGE_PATH = 'docs/publication/public-message.json';
export const PUBLIC_MESSAGE_HISTORY_DIR = 'docs/publication/history';

export const PUBLIC_MESSAGE_SYNC_TARGETS = Object.freeze([
  'README.md',
  'AGENTS.md',
  'CLAUDE.md',
  'docs/core-philosophy.md',
  'docs/manual/index.md',
  'docs/manual/guide/grand-design.md',
  'docs/manual/guide/judgment-system.md',
  'package.json'
]);

const COPY_KEYS = Object.freeze([
  'headline',
  'short_definition',
  'definition',
  'human_role',
  'ai_role',
  'package_description'
]);

const COPY_LIMITS = Object.freeze({
  headline: 80,
  short_definition: 160,
  definition: 400,
  human_role: 200,
  ai_role: 240,
  package_description: 240
});

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertPlainObject(value, label) {
  if (!isPlainObject(value)) {
    throw new TypeError(`${label} must be an object`);
  }
}

function assertExactKeys(value, allowed, label) {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) {
    throw new TypeError(`${label} contains unknown keys: ${unknown.join(', ')}`);
  }
}

function assertString(value, label, { max = 1000, pattern } = {}) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  if (value.length > max) {
    throw new TypeError(`${label} must be at most ${max} characters`);
  }
  if (pattern && !pattern.test(value)) {
    throw new TypeError(`${label} has an invalid format`);
  }
}

function assertDateTime(value, label) {
  assertString(value, label, { max: 80 });
  if (Number.isNaN(Date.parse(value))) {
    throw new TypeError(`${label} must be an ISO-compatible date-time`);
  }
}

export function validatePublicMessage(message, { requireGraphSource = false } = {}) {
  assertPlainObject(message, 'public message');
  assertExactKeys(
    message,
    ['schema_version', 'candidate_id', 'status', 'source', 'approval', 'copy'],
    'public message'
  );

  if (message.schema_version !== '1.0.0') {
    throw new TypeError('schema_version must be 1.0.0');
  }
  assertString(message.candidate_id, 'candidate_id', {
    max: 128,
    pattern: /^[a-z0-9][a-z0-9._-]{2,127}$/
  });
  if (message.status !== 'approved') {
    throw new TypeError('status must be approved');
  }

  assertPlainObject(message.source, 'source');
  const sourceType = message.source.type;
  if (requireGraphSource && sourceType !== 'brainbase_graph') {
    throw new TypeError('promotion candidates must have source.type=brainbase_graph');
  }

  if (sourceType === 'brainbase_graph') {
    assertExactKeys(
      message.source,
      ['type', 'entity_id', 'entity_version', 'snapshot_hash', 'exported_at', 'scope'],
      'source'
    );
    assertString(message.source.entity_id, 'source.entity_id', { max: 200 });
    if (
      message.source.entity_version !== undefined
      && (!Number.isInteger(message.source.entity_version) || message.source.entity_version < 1)
    ) {
      throw new TypeError('source.entity_version must be a positive integer when present');
    }
    assertString(message.source.snapshot_hash, 'source.snapshot_hash', {
      max: 71,
      pattern: /^sha256:[0-9a-f]{64}$/
    });
    assertDateTime(message.source.exported_at, 'source.exported_at');
    assertString(message.source.scope, 'source.scope', { max: 100 });
  } else if (sourceType === 'human_approved_baseline') {
    assertExactKeys(message.source, ['type', 'reference', 'recorded_at'], 'source');
    assertString(message.source.reference, 'source.reference', { max: 200 });
    assertDateTime(message.source.recorded_at, 'source.recorded_at');
  } else {
    throw new TypeError('source.type must be brainbase_graph or human_approved_baseline');
  }

  assertPlainObject(message.approval, 'approval');
  assertExactKeys(
    message.approval,
    ['status', 'approved_by', 'approved_at', 'reason'],
    'approval'
  );
  if (message.approval.status !== 'approved') {
    throw new TypeError('approval.status must be approved');
  }
  assertString(message.approval.approved_by, 'approval.approved_by', { max: 100 });
  assertDateTime(message.approval.approved_at, 'approval.approved_at');
  assertString(message.approval.reason, 'approval.reason', { max: 1000 });

  assertPlainObject(message.copy, 'copy');
  assertExactKeys(message.copy, COPY_KEYS, 'copy');
  for (const key of COPY_KEYS) {
    assertString(message.copy[key], `copy.${key}`, { max: COPY_LIMITS[key] });
  }

  return message;
}

export function canonicalize(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(',')}]`;
  }
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${canonicalize(value[key])}`
    )).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function sha256(value) {
  const bytes = typeof value === 'string' ? value : canonicalize(value);
  return `sha256:${createHash('sha256').update(bytes, 'utf8').digest('hex')}`;
}

export async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

export async function loadPublicMessage(root = process.cwd()) {
  const message = await readJson(join(resolve(root), PUBLIC_MESSAGE_PATH));
  return validatePublicMessage(message);
}

function replaceDelimited(text, startMarker, endMarker, body, path) {
  const firstStart = text.indexOf(startMarker);
  const secondStart = text.indexOf(startMarker, firstStart + startMarker.length);
  const end = text.indexOf(endMarker, firstStart + startMarker.length);

  if (firstStart < 0 || end < 0 || secondStart >= 0) {
    throw new Error(`${path} must contain exactly one ${startMarker} / ${endMarker} block`);
  }

  const before = text.slice(0, firstStart + startMarker.length);
  const after = text.slice(end);
  return `${before}\n${body.trim()}\n${after}`;
}

function yamlString(value) {
  return JSON.stringify(value);
}

function renderReadme(copy) {
  return `# Brainbase

## ${copy.headline}

${copy.definition}

> **${copy.short_definition}**

${copy.human_role}  
${copy.ai_role}`;
}

function renderAgentDefinition(copy) {
  return `This repository contains the OSS Brainbase judgment substrate and its local-first personal onboarding entry point. It is not limited to memory retrieval.

Brainbase's public promise is:

> **${copy.headline}**
>
> ${copy.definition}

The product boundary is explicit: ${copy.human_role} ${copy.ai_role}`;
}

function renderCorePhilosophy(copy) {
  return `## Central promise

> **${copy.headline}**

${copy.definition}

## Human and AI responsibility

- **Human:** ${copy.human_role.replace(/。$/, '')}。Human authority defines who the judgment is for, what it prioritizes, what it protects, and what may be delegated.
- **AI:** ${copy.ai_role.replace(/。$/, '')}。AI must search broadly, surface the strongest counterargument, preserve evidence, and stay inside approved execution boundaries.

A judgment is not correct in the abstract. It is correct or incorrect only relative to an explicit subject, objective, priority, protected constraint, and authority boundary.`;
}

function renderHomeHero(copy) {
  return `hero:
  name: Brainbase
  text: ${yamlString(copy.headline)}
  tagline: ${yamlString(copy.definition)}
  image:
    src: /assets/brainbase-hero.webp
    alt: 一人の判断をBrainbaseへ置き、複数のAIが壁打ちと実行に再利用する流れ
  actions:
    - theme: brand
      text: 自分の判断を1つ、AIへ渡してみる
      link: /guide/quick-start
    - theme: alt
      text: 複数のAIがどう動くかを見る
      link: /guide/grand-design
    - theme: alt
      text: 現在の実装を見る
      link: /guide/status`;
}

function renderHomeBody(copy) {
  return `## ${copy.short_definition}

${copy.human_role}  
${copy.ai_role}

Brainbaseが増やすのは、AIの数そのものではありません。あなたの判断が届く範囲です。判断はあなたのまま、AIの探索力・反証力・処理能力を乗せ、考える深さと同時に進められる仕事を増やします。`;
}

function renderGrandDesign(copy) {
  return `${copy.definition}

${copy.human_role}  
${copy.ai_role}

つまり、Brainbaseの目的はAIに情報を大量に渡すことではありません。**一人分の判断力を、複数のAIが再利用できる実行能力へ変えること**です。`;
}

function renderJudgmentSystem(copy) {
  return `${copy.short_definition}

${copy.human_role}  
${copy.ai_role}

この価値を実現する内部構造を、Brainbaseでは **Judgment DAG** と呼びます。DAGは商品コピーではなく、判断の根拠・依存関係・実行・評価を壊さず扱うための技術モデルです。`;
}

const MARKER_BLOCKS = Object.freeze([
  {
    path: 'README.md',
    start: '<!-- brainbase:public-message:start -->',
    end: '<!-- brainbase:public-message:end -->',
    render: renderReadme
  },
  {
    path: 'AGENTS.md',
    start: '<!-- brainbase:public-message:start -->',
    end: '<!-- brainbase:public-message:end -->',
    render: renderAgentDefinition
  },
  {
    path: 'CLAUDE.md',
    start: '<!-- brainbase:public-message:start -->',
    end: '<!-- brainbase:public-message:end -->',
    render: renderAgentDefinition
  },
  {
    path: 'docs/core-philosophy.md',
    start: '<!-- brainbase:public-message:start -->',
    end: '<!-- brainbase:public-message:end -->',
    render: renderCorePhilosophy
  },
  {
    path: 'docs/manual/index.md',
    start: '# brainbase:public-message:hero:start',
    end: '# brainbase:public-message:hero:end',
    render: renderHomeHero
  },
  {
    path: 'docs/manual/index.md',
    start: '<!-- brainbase:public-message:start -->',
    end: '<!-- brainbase:public-message:end -->',
    render: renderHomeBody
  },
  {
    path: 'docs/manual/guide/grand-design.md',
    start: '<!-- brainbase:public-message:start -->',
    end: '<!-- brainbase:public-message:end -->',
    render: renderGrandDesign
  },
  {
    path: 'docs/manual/guide/judgment-system.md',
    start: '<!-- brainbase:public-message:start -->',
    end: '<!-- brainbase:public-message:end -->',
    render: renderJudgmentSystem
  }
]);

async function atomicWrite(path, content) {
  await mkdir(dirname(path), { recursive: true });
  const tempPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tempPath, content, { encoding: 'utf8', flag: 'wx' });
  await rename(tempPath, path);
}

export async function renderSynchronizedFiles(root, message) {
  const absoluteRoot = resolve(root);
  const rendered = new Map();

  for (const block of MARKER_BLOCKS) {
    const absolutePath = join(absoluteRoot, block.path);
    const current = rendered.has(block.path)
      ? rendered.get(block.path)
      : await readFile(absolutePath, 'utf8');
    rendered.set(
      block.path,
      replaceDelimited(current, block.start, block.end, block.render(message.copy), block.path)
    );
  }

  const packagePath = join(absoluteRoot, 'package.json');
  const packageJson = JSON.parse(await readFile(packagePath, 'utf8'));
  packageJson.description = message.copy.package_description;
  rendered.set('package.json', `${JSON.stringify(packageJson, null, 2)}\n`);

  return rendered;
}

export async function syncPublicMessage(root = process.cwd(), { write = false } = {}) {
  const absoluteRoot = resolve(root);
  const message = await loadPublicMessage(absoluteRoot);
  const rendered = await renderSynchronizedFiles(absoluteRoot, message);
  const changedFiles = [];

  for (const [relativePath, expected] of rendered) {
    const absolutePath = join(absoluteRoot, relativePath);
    const current = await readFile(absolutePath, 'utf8');
    if (current !== expected) {
      changedFiles.push(relativePath);
      if (write) {
        await atomicWrite(absolutePath, expected);
      }
    }
  }

  if (!write && changedFiles.length > 0) {
    throw new Error(`public-message projection drift: ${changedFiles.join(', ')}`);
  }

  return { message, changedFiles };
}

export async function pathExists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

export async function writeJsonAtomic(path, value) {
  await atomicWrite(path, `${JSON.stringify(value, null, 2)}\n`);
}
