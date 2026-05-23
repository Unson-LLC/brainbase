#!/usr/bin/env npx tsx

/**
 * capability-map-reminder hook (条件付き) のテスト
 *
 * 陽性パターン (brainbase 機能/UI/動かない系) で systemMessage 非空、
 * 陰性パターン (無関係技術) で systemMessage 空文字、を assert。
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
  "../hooks/user-prompt-submit/capability-map-reminder.ts",
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
  // 陽性: brainbase 機能/UI
  { label: "session-create", prompt: "session作成できない", expectNonEmpty: true },
  { label: "xterm-bug", prompt: "xtermの描画バグを直して", expectNonEmpty: true },
  { label: "auth-grant", prompt: "auth grantの設定を確認", expectNonEmpty: true },
  { label: "port-31013", prompt: "port 31013 が動いてない", expectNonEmpty: true },
  { label: "brainbase-feature", prompt: "brainbaseで何ができるか教えて", expectNonEmpty: true },

  // 陰性: 無関係技術
  { label: "github-actions", prompt: "GitHub Actions yamlを書いて", expectNonEmpty: false },
  { label: "react-new", prompt: "新しい React component 作る", expectNonEmpty: false },
  { label: "pg-slow", prompt: "PostgreSQL の slow query 調査", expectNonEmpty: false },
  { label: "ts-type", prompt: "TypeScript の type 修正", expectNonEmpty: false },
  { label: "npm-install", prompt: "npm install してください", expectNonEmpty: false },
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
