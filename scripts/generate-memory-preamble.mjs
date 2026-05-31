#!/usr/bin/env node
// @ts-check
//
// generate-memory-preamble: 3層メモリ (個人KG / Graph SSOT カタログ / Capability menu)
// を1ファイルに materialize する。SessionStart hook はこのファイルを読むだけ。
//
// 出力: ~/.brainbase/memory-preamble.txt (≤ ~2000 token 目安)
//
// なぜ standalone か:
// - SessionStart hook に DB / Lightsail tunnel を持ち込まない (落ちると hook が固まる)
// - 生成は重い (Graph API / candidate 読み) ので、日次 or 手動で先に materialize しておく
//
// 使い方:
//   node scripts/generate-memory-preamble.mjs            # 生成して ~/.brainbase/ に書く
//   node scripts/generate-memory-preamble.mjs --stdout   # 標準出力に出す (確認用)
//   node scripts/generate-memory-preamble.mjs --out /path # 出力先指定

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

const GRAPH_API = process.env.BRAINBASE_GRAPH_API_URL || 'https://bb.unson.jp';
const WIKI_API = process.env.BRAINBASE_WIKI_API_URL || 'http://localhost:31013';
const PROJECTS = process.env.BRAINBASE_PROJECTS || 'brainbase,unson,salestailor,techknight,baao,mana,aitle';
const CLEARANCE = process.env.BRAINBASE_CLEARANCE || 'internal,restricted,finance,hr,contract';
const ROLE = process.env.BRAINBASE_ROLE || 'gm';
const CAP_DIR = process.env.CAPABILITY_DIR
  || path.join(process.cwd(), 'docs/brainbase-capabilities/capabilities');

function readToken() {
  try {
    const raw = fs.readFileSync(path.join(os.homedir(), '.brainbase/tokens.json'), 'utf8');
    return JSON.parse(raw).access_token || '';
  } catch {
    return '';
  }
}

function graphHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    'x-brainbase-role': ROLE,
    'x-brainbase-projects': PROJECTS,
    'x-brainbase-clearance': CLEARANCE,
  };
}

async function fetchGraphNames(type, token) {
  try {
    const res = await fetch(`${GRAPH_API}/api/info/graph/entities?type=${type}&limit=500`, {
      headers: graphHeaders(token),
    });
    if (!res.ok) return [];
    const data = await res.json();
    const records = data.records || data.entities || [];
    return records
      .map((r) => (r.payload && r.payload.name) || '')
      .filter((n) => n && !n.startsWith('__deprecated'));
  } catch {
    return [];
  }
}

async function fetchPersonalKg(token) {
  // owner-visible personal_kg_core を memory_candidates から。失敗しても空で続行。
  for (const base of [WIKI_API, GRAPH_API]) {
    try {
      const res = await fetch(`${base}/api/learning/memory-candidates?limit=200`, {
        headers: graphHeaders(token),
      });
      if (!res.ok) continue;
      const data = await res.json();
      const items = data.candidates || data.items || data.records || [];
      const core = items.filter((c) => {
        const layer = c.memory_layer || (c.oyasumi_policy && c.oyasumi_policy.memory_layer);
        const vis = c.visibility || 'owner';
        return vis === 'owner' && layer !== 'sns_ready';
      });
      if (core.length) return core;
    } catch {
      // try next base
    }
  }
  return [];
}

function capabilityIds() {
  try {
    return fs.readdirSync(CAP_DIR)
      .filter((f) => f.endsWith('.yml'))
      .map((f) => f.replace(/\.yml$/u, ''))
      .sort();
  } catch {
    return [];
  }
}

function truncate(arr, n) {
  return arr.length > n ? arr.slice(0, n).concat([`…他${arr.length - n}`]) : arr;
}

async function build() {
  const token = readToken();
  const [persons, orgs, customers] = await Promise.all([
    fetchGraphNames('person', token),
    fetchGraphNames('org', token),
    fetchGraphNames('customer', token),
  ]);
  const kg = await fetchPersonalKg(token);
  const caps = capabilityIds();

  const today = new Date().toISOString().slice(0, 10);
  const lines = [];
  lines.push(`[Brainbase memory preamble — ${today}]`);
  lines.push('返答前に: 固有名詞・機能・判断が下記に該当したら、記憶/推測で書く前に pull (MCP search / yml Read) で一次情報を引け。該当が無ければ「SSOTに未登録」と明示してから推測に移る。');
  lines.push('');

  // 1. 個人KG (判断OS)
  lines.push('■ 個人KG (佐藤圭吾の判断OS / oyasumi 蓄積)');
  if (kg.length) {
    const sorted = kg
      .slice()
      .sort((a, b) => (b.importance || 0) - (a.importance || 0))
      .map((c) => (c.summary || c.content || '').replace(/\s+/gu, ' ').trim())
      .filter(Boolean);
    for (const t of truncate(sorted, 6)) lines.push(`  - ${t.slice(0, 110)}`);
  } else {
    lines.push('  (取得0件: oyasumi 未実行 or 取得失敗。/oyasumi で蓄積)');
  }
  lines.push('  深掘り: brainbase MCP search / personal-kg.yml');
  lines.push('');

  // 2. Graph SSOT カタログ
  lines.push('■ Graph SSOT 登録エンティティ (これらの名前が出たら推測せず get_entity/search で引く)');
  lines.push(`  people(${persons.length}): ${truncate(persons, 20).join(', ')}`);
  lines.push(`  org(${orgs.length}): ${truncate(orgs, 19).join(', ')}`);
  lines.push(`  customer(${customers.length}): ${truncate(customers, 12).join(', ')}`);
  lines.push('');

  // 3. Capability menu
  lines.push('■ Capability Map (機能/障害/session作成/31013/auth/terminal は capability-map skill で該当 yml を必ず Read)');
  lines.push(`  capability_id: ${caps.join(', ')}`);
  lines.push('');

  // 4. merge guardrail (旧 merge-api-reminder を1行に集約)
  lines.push('■ merge: session マージは Brainbase merge API (/merge) 経由。raw git merge / gh pr merge を session マージに使わない。');

  return { text: lines.join('\n'), counts: { persons: persons.length, orgs: orgs.length, customers: customers.length, kg: kg.length, caps: caps.length } };
}

async function main() {
  const argv = process.argv.slice(2);
  const toStdout = argv.includes('--stdout');
  const outIdx = argv.indexOf('--out');
  const outPath = outIdx >= 0 ? argv[outIdx + 1] : path.join(os.homedir(), '.brainbase/memory-preamble.txt');

  const { text, counts } = await build();

  if (toStdout) {
    process.stdout.write(text + '\n');
  } else {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, text + '\n', { mode: 0o600 });
    const approxTokens = Math.round(text.length / 3.2);
    process.stderr.write(`memory-preamble written: ${outPath} (~${approxTokens} tokens) counts=${JSON.stringify(counts)}\n`);
  }
}

void main();
