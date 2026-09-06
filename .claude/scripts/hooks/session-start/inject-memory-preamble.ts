#!/usr/bin/env npx tsx

// SessionStart: 3層メモリ preamble (個人KG / Graph SSOT カタログ / Capability menu)
// を session 冒頭に1回だけ注入する。
//
// 設計 (2026-05-31):
// - 10日間の監査で「毎プロンプト reminder」は無効と実証 → SessionStart 1回の
//   content 注入に置換 (AgentMemory の SessionStart project profile と同型)。
// - hook は ~/.brainbase/memory-preamble.txt を読むだけ。DB / Lightsail tunnel を
//   hot path に持ち込まない。生成は日次ルーティンと分離し、
//   scripts/generate-memory-preamble.mjs で明示的に materialize する。
// - file が無い/古い時は安全に縮退 (本文を注入しない)。

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { logHookExecution } from "../../lib/logging/hook-logger.js";

const PREAMBLE_PATH =
  process.env.BRAINBASE_MEMORY_PREAMBLE
  || path.join(os.homedir(), ".brainbase", "memory-preamble.txt");

const STALE_DAYS = 2;

function loadPreamble(): { text: string; note: string } {
  try {
    const stat = fs.statSync(PREAMBLE_PATH);
    const ageMs = Date.now() - stat.mtimeMs;
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    const text = fs.readFileSync(PREAMBLE_PATH, "utf8").trim();
    if (!text) return { text: "", note: "empty" };
    const match = text.match(/^\[Brainbase memory preamble — (\d{4}-\d{2}-\d{2})\]/u);
    const generatedAt = match ? Date.parse(`${match[1]}T00:00:00Z`) : NaN;
    const validDate = Number.isFinite(generatedAt)
      && new Date(generatedAt).toISOString().slice(0, 10) === match?.[1];
    const generatedAgeDays = Math.floor((Date.now() - generatedAt) / 86400000);
    if (!validDate || generatedAgeDays < 0 || Math.max(ageDays, generatedAgeDays) > STALE_DAYS) {
      return { text: "", note: "stale_or_invalid_date" };
    }
    return { text, note: "" };
  } catch {
    return { text: "", note: "missing" };
  }
}

async function main() {
  const { text, note } = loadPreamble();
  try {
    if (!text) {
      logHookExecution("SessionStart", "inject-memory-preamble", `preamble なし (${note}) → スキップ`);
      console.log(JSON.stringify({ continue: true, systemMessage: "", suppressOutput: true }));
      return;
    }
    logHookExecution("SessionStart", "inject-memory-preamble", `3層 preamble 注入${note ? " [stale]" : ""}`);
    console.log(
      JSON.stringify({
        continue: true,
        systemMessage: text + note,
        suppressOutput: true,
      }),
    );
  } catch (error) {
    logHookExecution(
      "SessionStart",
      "inject-memory-preamble",
      `エラー: ${error instanceof Error ? error.message : String(error)}`,
    );
    console.log(JSON.stringify({ continue: true, systemMessage: "", suppressOutput: true }));
  }
}

void main();
