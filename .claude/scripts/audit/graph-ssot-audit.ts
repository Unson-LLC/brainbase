#!/usr/bin/env npx tsx

/**
 * Graph SSOT / Capability Map / Personal KG の日次利用監査 (Phase 1: 粗集計)。
 *
 * 直近 N 時間の Claude Code / Codex セッションを舐めて、各 session を
 * classifyTopic で分類し、真の引きを検出。JSON で出力する。
 *
 * Phase 2 (価値判定: valuable/wasted/unnecessary/should_have_queried) は
 * LLM judgment が必要なので、本 script の責務外。agent 側に残す。
 *
 * Usage:
 *   npx tsx .claude/scripts/audit/graph-ssot-audit.ts \
 *     [--hours 24] \
 *     [--out /tmp/graph_ssot_audit_<date>.json]
 *
 * 出力 schema:
 *   {
 *     generated_at: ISO string,
 *     cutoff: ISO string,
 *     hours: number,
 *     totals: { claude_main, claude_sub, codex, all },
 *     excluded: { vibepro_reviewer, audit_meta, total },
 *     by_worktree: { <name>: {...counts...} },
 *     results: [ { source, path, cwd, worktree, mtime, first_prompt, ...} ]
 *   }
 */

import { readdirSync, statSync, createReadStream } from "node:fs";
import { writeFileSync } from "node:fs";
import { join, basename, dirname } from "node:path";
import { homedir } from "node:os";
import { createInterface } from "node:readline";
import { classifyTopic, type TopicResult } from "./classify.js";

// ──────────────────────────────────────────────────────────────────────────────
// CLI args
// ──────────────────────────────────────────────────────────────────────────────

interface Args {
  hours: number;
  out: string;
}

function parseArgs(): Args {
  const a = process.argv.slice(2);
  let hours = 24;
  let out = `/tmp/graph_ssot_audit_${new Date().toISOString().slice(0, 10)}.json`;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === "--hours") hours = Number(a[++i]);
    else if (a[i] === "--out") out = a[++i];
  }
  return { hours, out };
}

// ──────────────────────────────────────────────────────────────────────────────
// File discovery
// ──────────────────────────────────────────────────────────────────────────────

interface DiscoveredFile {
  source: "claude" | "claude-sub" | "codex";
  path: string;
  mtime: Date;
}

function listClaudeProjects(): string[] {
  const root = join(homedir(), ".claude", "projects");
  try {
    return readdirSync(root)
      .filter((n) => n.includes("Volumes") && n.includes("brainbase-worktrees"))
      .map((n) => join(root, n));
  } catch {
    return [];
  }
}

function walkJsonl(dir: string): { path: string; mtime: Date }[] {
  const out: { path: string; mtime: Date }[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = join(dir, e);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      out.push(...walkJsonl(p));
    } else if (e.endsWith(".jsonl")) {
      out.push({ path: p, mtime: st.mtime });
    }
  }
  return out;
}

function discoverFiles(hours: number): DiscoveredFile[] {
  const cutoff = Date.now() - hours * 3600 * 1000;
  const out: DiscoveredFile[] = [];

  // Claude Code
  for (const projDir of listClaudeProjects()) {
    for (const f of walkJsonl(projDir)) {
      if (f.mtime.getTime() < cutoff) continue;
      const isSub = f.path.includes("/subagents/");
      out.push({ source: isSub ? "claude-sub" : "claude", path: f.path, mtime: f.mtime });
    }
  }

  // Codex
  const codexRoot = join(homedir(), ".codex", "sessions");
  try {
    for (const f of walkJsonl(codexRoot)) {
      if (f.mtime.getTime() < cutoff) continue;
      if (!basename(f.path).startsWith("rollout-")) continue;
      out.push({ source: "codex", path: f.path, mtime: f.mtime });
    }
  } catch {
    // ignore
  }

  return out;
}

// ──────────────────────────────────────────────────────────────────────────────
// Worktree classification
// ──────────────────────────────────────────────────────────────────────────────

const KNOWN_WORKTREES = [
  "brainbase",
  "salestailor-app",
  "salestailor",
  "techknight",
  "tech-knight",
  "baao",
  "mana",
  "unson",
  "ncom-catalyst",
  "back-office",
  "back_office",
  "aitle",
  "oyasumi",
];

function detectWorktree(cwd: string, path: string): string {
  // cwd か path に含まれる -g1-<name> または session-...-<name> suffix を拾う
  const search = `${cwd} ${path}`;
  for (const wt of KNOWN_WORKTREES) {
    // boundary を緩めに見る
    if (new RegExp(`(?:-g1-|session-\\d+-|-)${wt}\\b`).test(search)) return wt.replace("_", "-");
  }
  return "other";
}

// ──────────────────────────────────────────────────────────────────────────────
// jsonl parsing
// ──────────────────────────────────────────────────────────────────────────────

interface SessionExtract {
  cwd: string;
  first_prompt: string;
  tool_call_names: string[]; // mcp__brainbase__* など
  bash_commands: string[]; // 最初の Nだけ
  skill_loads: string[]; // brainbase-capability-map 等
  capmap_yaml_read: boolean; // docs/brainbase-capabilities/capabilities/*.yml の Read
  preamble_injected: boolean; // SessionStart memory-preamble が注入されたか
}

// memory-preamble の先頭マーカー (generate-memory-preamble.mjs / inject-memory-preamble)。
// claude は <session-start-hook>、codex は hookSpecificOutput.additionalContext として
// transcript jsonl に残るので、生の line に対する substring 検出が最も頑健。
const PREAMBLE_MARKER = "Brainbase memory preamble";

async function parseClaudeJsonl(path: string): Promise<SessionExtract> {
  const ext: SessionExtract = {
    cwd: "",
    first_prompt: "",
    tool_call_names: [],
    bash_commands: [],
    skill_loads: [],
    capmap_yaml_read: false,
    preamble_injected: false,
  };
  // cwd は path から推測
  const projName = basename(dirname(path));
  ext.cwd = projName.replace(/^-/, "/").replace(/-/g, "/");

  const rl = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    if (!ext.preamble_injected && line.includes(PREAMBLE_MARKER)) ext.preamble_injected = true;
    let obj: any;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    if (obj.type === "user" && !ext.first_prompt) {
      const content = obj.message?.content;
      if (typeof content === "string") ext.first_prompt = content.slice(0, 4000);
      else if (Array.isArray(content)) {
        const t = content.find((c: any) => c.type === "text")?.text;
        if (t) ext.first_prompt = String(t).slice(0, 4000);
      }
    }
    if (obj.type === "assistant" && Array.isArray(obj.message?.content)) {
      for (const c of obj.message.content) {
        if (c.type === "tool_use") {
          const name = c.name || "";
          if (name) ext.tool_call_names.push(name);
          if (name === "Bash" && c.input?.command) {
            const cmd = String(c.input.command);
            if (ext.bash_commands.length < 50) ext.bash_commands.push(cmd.slice(0, 400));
          }
          if (name === "Read" && c.input?.file_path) {
            const fp = String(c.input.file_path);
            if (/docs\/brainbase-capabilities\/capabilities\/[^/]+\.ya?ml$/.test(fp)) {
              ext.capmap_yaml_read = true;
            }
          }
          if (name === "Skill" && c.input?.skill) {
            ext.skill_loads.push(String(c.input.skill));
          }
        }
      }
    }
  }
  return ext;
}

async function parseCodexJsonl(path: string): Promise<SessionExtract> {
  const ext: SessionExtract = {
    cwd: "",
    first_prompt: "",
    tool_call_names: [],
    bash_commands: [],
    skill_loads: [],
    capmap_yaml_read: false,
    preamble_injected: false,
  };

  const rl = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    if (!ext.preamble_injected && line.includes(PREAMBLE_MARKER)) ext.preamble_injected = true;
    let obj: any;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    if (obj.type === "session_meta" && obj.payload?.cwd && !ext.cwd) {
      ext.cwd = obj.payload.cwd;
    }
    if (obj.type === "event_msg") {
      const p = obj.payload;
      if (p?.type === "user_message" && !ext.first_prompt) {
        const t = p.message ?? p.text ?? "";
        if (typeof t === "string") ext.first_prompt = t.slice(0, 4000);
      }
      if (p?.type === "tool_call_started") {
        const name = p.tool_name || p.name || "";
        if (name) ext.tool_call_names.push(String(name));
      }
    }
    if (obj.type === "response_item") {
      const p = obj.payload;
      if (p?.type === "function_call" && p.name) {
        ext.tool_call_names.push(String(p.name));
        if (String(p.name) === "shell" && p.arguments) {
          try {
            const args = typeof p.arguments === "string" ? JSON.parse(p.arguments) : p.arguments;
            const cmd = Array.isArray(args.command) ? args.command.join(" ") : args.command;
            if (cmd && ext.bash_commands.length < 50)
              ext.bash_commands.push(String(cmd).slice(0, 400));
          } catch {
            // ignore
          }
        }
      }
    }
  }
  return ext;
}

// ──────────────────────────────────────────────────────────────────────────────
// Query detection (graph / capmap / kg)
// ──────────────────────────────────────────────────────────────────────────────

interface QueryFlags {
  graph: boolean;
  capmap_real: boolean;
  capmap_ceremonial: boolean;
  kg: boolean;
  graph_tools: string[];
}

function detectQueries(ext: SessionExtract): QueryFlags {
  const flags: QueryFlags = {
    graph: false,
    capmap_real: false,
    capmap_ceremonial: false,
    kg: false,
    graph_tools: [],
  };

  // Graph: mcp__brainbase__* または curl bb.unson.jp
  for (const t of ext.tool_call_names) {
    if (
      /^mcp__brainbase__(search|list_entities|get_entity|get_context|search_wiki|get_wiki_page)$/.test(
        t,
      )
    ) {
      flags.graph = true;
      flags.graph_tools.push(t);
    }
  }
  for (const c of ext.bash_commands) {
    if (/curl[^\n]*bb\.unson\.jp\/api\/info\/(graph|wiki|decisions)/.test(c)) {
      flags.graph = true;
      flags.graph_tools.push("curl:bb.unson.jp");
    }
  }

  // Capmap: SKILL.md cat/sed のみ = 儀式扱い、yaml 本体 Read = 真の引き
  const ceremonialCommands = ext.bash_commands.some((c) =>
    /(?:cat|sed|less|head|tail|nl)[^\n]+brainbase-capability-map\/SKILL\.md/.test(c),
  );
  if (ceremonialCommands || ext.skill_loads.includes("brainbase-capability-map")) {
    flags.capmap_ceremonial = true;
  }
  if (ext.capmap_yaml_read) {
    flags.capmap_real = true;
  }

  // KG: /oyasumi or oyasumi 関連
  if (
    ext.first_prompt &&
    /\/oyasumi|個人KG|personal[_-]?kg|oyasumi[\s_-]/i.test(ext.first_prompt)
  ) {
    flags.kg = true;
  }
  for (const c of ext.bash_commands) {
    if (/npm run oyasumi/i.test(c) || /oyasumi-meeting/.test(c)) {
      flags.kg = true;
    }
  }

  return flags;
}

// ──────────────────────────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────────────────────────

interface ResultRow {
  source: "claude" | "claude-sub" | "codex";
  path: string;
  cwd: string;
  worktree: string;
  mtime: string;
  first_prompt: string;
  topic: TopicResult;
  query: QueryFlags;
  tool_call_count: number;
  preamble_injected: boolean;
}

// このセッションで「真の引き」が起きたか (graph / capmap yaml / kg のいずれか)。
// preamble の効果測定 (注入された session が実際に pull したか) に使う。
function didRealQuery(query: QueryFlags): boolean {
  return query.graph || query.capmap_real || query.kg;
}

async function main() {
  const args = parseArgs();
  const cutoff = new Date(Date.now() - args.hours * 3600 * 1000);
  const files = discoverFiles(args.hours);

  const results: ResultRow[] = [];
  for (const f of files) {
    const ext = f.source === "codex" ? await parseCodexJsonl(f.path) : await parseClaudeJsonl(f.path);
    const topic = classifyTopic(ext.first_prompt);
    const query = detectQueries(ext);
    const worktree = detectWorktree(ext.cwd, f.path);
    results.push({
      source: f.source,
      path: f.path,
      cwd: ext.cwd,
      worktree,
      mtime: f.mtime.toISOString(),
      first_prompt: ext.first_prompt.slice(0, 500),
      topic,
      query,
      tool_call_count: ext.tool_call_names.length,
      preamble_injected: ext.preamble_injected,
    });
  }

  // Aggregations
  const totals = {
    claude_main: results.filter((r) => r.source === "claude").length,
    claude_sub: results.filter((r) => r.source === "claude-sub").length,
    codex: results.filter((r) => r.source === "codex").length,
    all: results.length,
  };
  const excluded = {
    vibepro_reviewer: results.filter((r) => r.topic.excluded === "vibepro-reviewer").length,
    audit_meta: results.filter((r) => r.topic.excluded === "audit-meta").length,
    total: results.filter((r) => r.topic.excluded !== null).length,
  };

  const byWorktree: Record<
    string,
    {
      total: number;
      graph_candidate: number;
      graph_queried: number;
      capmap_candidate: number;
      capmap_real_loaded: number;
      capmap_ceremonial: number;
      kg_candidate: number;
      kg_queried: number;
      excluded: number;
      preamble_injected: number;
      preamble_then_query: number;
    }
  > = {};
  for (const r of results) {
    const w = (byWorktree[r.worktree] ??= {
      total: 0,
      graph_candidate: 0,
      graph_queried: 0,
      capmap_candidate: 0,
      capmap_real_loaded: 0,
      capmap_ceremonial: 0,
      kg_candidate: 0,
      kg_queried: 0,
      excluded: 0,
      preamble_injected: 0,
      preamble_then_query: 0,
    });
    w.total++;
    if (r.topic.excluded) {
      w.excluded++;
      continue;
    }
    if (r.topic.graph) w.graph_candidate++;
    if (r.query.graph) w.graph_queried++;
    if (r.topic.capmap) w.capmap_candidate++;
    if (r.query.capmap_real) w.capmap_real_loaded++;
    if (r.query.capmap_ceremonial) w.capmap_ceremonial++;
    if (r.topic.kg) w.kg_candidate++;
    if (r.query.kg) w.kg_queried++;
    if (r.preamble_injected) {
      w.preamble_injected++;
      if (didRealQuery(r.query)) w.preamble_then_query++;
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Preamble 利用率: 注入された session が実際に pull したか。
  // 注入あり/なしで real query 率を比較し、preamble の効果 (before/after) を測る。
  // 母集団は excluded を除いた非メタ session。
  // ──────────────────────────────────────────────────────────────────────────
  const candidateSessions = results.filter((r) => !r.topic.excluded);
  const injected = candidateSessions.filter((r) => r.preamble_injected);
  const notInjected = candidateSessions.filter((r) => !r.preamble_injected);
  const rate = (num: number, den: number) =>
    den > 0 ? Number((num / den).toFixed(4)) : 0;
  const injectedQueried = injected.filter((r) => didRealQuery(r.query)).length;
  const notInjectedQueried = notInjected.filter((r) => didRealQuery(r.query)).length;
  const preamble = {
    candidate_sessions: candidateSessions.length,
    injected: injected.length,
    injected_rate: rate(injected.length, candidateSessions.length),
    by_source: {
      claude: injected.filter((r) => r.source === "claude").length,
      claude_sub: injected.filter((r) => r.source === "claude-sub").length,
      codex: injected.filter((r) => r.source === "codex").length,
    },
    // 注入された session のうち、実際に graph/capmap-yaml/kg を引いた割合
    query_when_injected: injectedQueried,
    query_rate_when_injected: rate(injectedQueried, injected.length),
    // baseline: 注入されなかった session の real query 率 (比較対象)
    query_when_not_injected: notInjectedQueried,
    query_rate_when_not_injected: rate(notInjectedQueried, notInjected.length),
  };

  const payload = {
    generated_at: new Date().toISOString(),
    cutoff: cutoff.toISOString(),
    hours: args.hours,
    totals,
    excluded,
    preamble,
    by_worktree: byWorktree,
    results,
  };

  writeFileSync(args.out, JSON.stringify(payload, null, 2));
  // stdout: summary
  console.log(
    JSON.stringify(
      {
        totals,
        excluded,
        preamble,
        by_worktree: byWorktree,
        out: args.out,
        result_count: results.length,
      },
      null,
      2,
    ),
  );
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
