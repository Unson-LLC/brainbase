#!/usr/bin/env npx tsx

/**
 * graph-ssot-reminder hook (条件付き) のテスト
 *
 * 陽性パターン (人物名/顧客名/案件キーワード検出) で systemMessage 非空、
 * 陰性パターン (純技術プロンプト) で systemMessage 空文字、を assert。
 */

import { execFileSync } from "child_process";
import * as path from "path";
import { fileURLToPath } from "url";

interface HookOutput {
  continue: boolean;
  systemMessage: string;
  suppressOutput: boolean;
}

interface Case {
  label: string;
  prompt: string;
  expectNonEmpty: boolean;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const HOOK_PATH = path.resolve(
  __dirname,
  "../hooks/user-prompt-submit/graph-ssot-reminder.ts",
);

function runHook(prompt: string): HookOutput {
  const stdout = execFileSync("npx", ["tsx", HOOK_PATH], {
    encoding: "utf8",
    timeout: 10000,
    env: { ...process.env, CLAUDE_USER_PROMPT: prompt },
  });
  return JSON.parse(stdout) as HookOutput;
}

const cases: Case[] = [
  // 陽性: 人物名 (漢字+さん/氏)
  { label: "kanji-name-san", prompt: "安部潔仁さんとのMTG準備して", expectNonEmpty: true },
  { label: "kanji-name-shi", prompt: "川合 秀明氏の連絡先を教えて", expectNonEmpty: true },
  // 陽性: 顧客/組織名
  { label: "org-baao", prompt: "BAAO案件の決裁者を確認", expectNonEmpty: true },
  { label: "org-universalarts", prompt: "ユニバーサルアーツの担当者誰だっけ", expectNonEmpty: true },
  // 陽性: 関係性キーワード
  { label: "keyword-keiketsu", prompt: "今期の決裁ルートを整理", expectNonEmpty: true },

  // 陰性: 純技術
  { label: "tech-react", prompt: "このreact componentをリファクタして", expectNonEmpty: false },
  { label: "tech-bug", prompt: "lib/foo.tsのbugを直して", expectNonEmpty: false },
  { label: "tech-npm", prompt: "npm test failed の調査", expectNonEmpty: false },
  { label: "tech-build", prompt: "build errorが発生してる", expectNonEmpty: false },
  { label: "tech-type", prompt: "型定義を追加", expectNonEmpty: false },
];

let pass = 0;
let fail = 0;
const failures: string[] = [];

for (const c of cases) {
  try {
    const out = runHook(c.prompt);
    const isNonEmpty = (out.systemMessage ?? "").trim().length > 0;
    if (isNonEmpty === c.expectNonEmpty) {
      pass++;
      console.log(`ok  ${c.label}: ${c.expectNonEmpty ? "non-empty" : "empty"}`);
    } else {
      fail++;
      const msg = `FAIL ${c.label}: expected ${c.expectNonEmpty ? "non-empty" : "empty"}, got ${
        isNonEmpty ? `non-empty (${out.systemMessage.substring(0, 60)}...)` : "empty"
      }`;
      console.log(msg);
      failures.push(msg);
    }
  } catch (e) {
    fail++;
    const msg = `FAIL ${c.label}: exception ${e instanceof Error ? e.message : String(e)}`;
    console.log(msg);
    failures.push(msg);
  }
}

console.log(`\n${pass} pass, ${fail} fail`);
if (fail > 0) {
  console.error("\nfailures:");
  failures.forEach((f) => console.error(`  ${f}`));
  process.exit(1);
}
