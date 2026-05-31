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
import pg from 'pg';
import { PgCandidateRepository } from '../server/services/candidate-store/candidate-repository.js';

const { Pool } = pg;

const GRAPH_API = process.env.BRAINBASE_GRAPH_API_URL || 'https://bb.unson.jp';
const PROJECTS = process.env.BRAINBASE_PROJECTS || 'brainbase,unson,salestailor,techknight,baao,mana,aitle';
const CLEARANCE = process.env.BRAINBASE_CLEARANCE || 'internal,restricted,finance,hr,contract';
const ROLE = process.env.BRAINBASE_ROLE || 'gm';
const CAP_DIR = process.env.CAPABILITY_DIR
  || path.join(process.cwd(), 'docs/brainbase-capabilities/capabilities');

// 個人KG (memory_candidates) は SNS context service と同じ owner / 判断軸を読む。
const PERSONAL_KG_OWNER = process.env.MEMORY_PREAMBLE_OWNER_PERSON_ID || 'sato_keigo';
const PERSONAL_KG_TYPES = ['insight', 'claim'];
const PERSONAL_KG_TOP = Number(process.env.MEMORY_PREAMBLE_KG_TOP || 6);

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

function personalKgDatabaseConfig() {
  // サーバと同じ pool factory (new Pool({ connectionString })) を再利用する。
  // 手組み host/port URL は "base" parse 失敗の罠があるため接続文字列のみ使う。
  // Lightsail tunnel は localhost:25432 (INFO_SSOT_DATABASE_URL に入っている)。
  const url = process.env.INFO_SSOT_DATABASE_URL
    || process.env.INFO_SSOT_DB_URL
    || process.env.DATABASE_URL;
  return url ? { connectionString: url } : null;
}

async function fetchPersonalKg() {
  // owner-visible な insight/claim を memory_candidates から body 付きで読む。
  // list API (/api/learning/memory-candidates) は body を返さないため使わず、
  // SNS context service と同じ PgCandidateRepository 経路で読む。失敗しても空で続行。
  const config = personalKgDatabaseConfig();
  if (!config) return [];
  const pool = new Pool(config);
  try {
    const repo = new PgCandidateRepository({ pool });
    const byType = await Promise.all(
      PERSONAL_KG_TYPES.map((cognitive_type) =>
        repo.list({ owner_person_id: PERSONAL_KG_OWNER, cognitive_type })),
    );
    return byType
      .flat()
      .filter((c) => c.visibility === 'owner')
      .filter((c) => String(c.body || '').trim().length > 0)
      // confidence 降順 → 直近 created_at 降順
      .sort((a, b) => {
        const conf = Number(b.confidence || 0) - Number(a.confidence || 0);
        if (conf !== 0) return conf;
        return String(b.created_at || '').localeCompare(String(a.created_at || ''));
      });
  } catch {
    return [];
  } finally {
    await pool.end().catch(() => {});
  }
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
  const kg = await fetchPersonalKg();
  const caps = capabilityIds();

  const today = new Date().toISOString().slice(0, 10);
  const lines = [];
  lines.push(`[Brainbase memory preamble — ${today}]`);
  lines.push('返答前に: 固有名詞・機能・判断が下記に該当したら、記憶/推測で書く前に pull (MCP search / yml Read) で一次情報を引け。該当が無ければ「SSOTに未登録」と明示してから推測に移る。');
  lines.push('');

  // 1. 個人KG (判断OS)
  lines.push('■ 個人KG (佐藤圭吾の判断OS / oyasumi 蓄積)');
  if (kg.length) {
    // fetchPersonalKg で confidence + created_at ランク済み。body をそのまま使う。
    const ranked = kg
      .map((c) => String(c.body || '').replace(/\s+/gu, ' ').trim())
      .filter(Boolean);
    for (const t of truncate(ranked, PERSONAL_KG_TOP)) lines.push(`  - ${t.slice(0, 110)}`);
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
