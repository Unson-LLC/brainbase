#!/usr/bin/env npx tsx

/**
 * git push gate: VibePro pr prepare の gate_dag を検証してから push を許可する。
 *
 * 効力:
 * - Claude Code Bash tool で `git push ...` を実行しようとした時に発火
 * - vibepro CLI が gate_dag.overall_status === 'ready_for_review' を返さないと deny
 *
 * escape:
 * - BRAINBASE_ALLOW_PUSH_WITHOUT_GATE=1 を export
 * - non session/* branch は skip
 *
 * 配置: settings.json の PreToolUse Bash matcher（forbidden-commands の後）
 */

import { execFileSync, spawnSync } from "child_process";
import { existsSync } from "fs";
import { logHookExecution } from "../../lib/logging/hook-logger.js";

interface BashToolInput {
  tool: string;
  parameters: { command: string };
}

interface HookResult {
  permissionDecision: "allow" | "deny";
  blocked: boolean;
  reason?: string;
}

function isGitPushCommand(command: string): boolean {
  // `git push` を含む（ただし `git push --no-verify` は別ツール経由なのでここは見ない）
  // pre-commit / pre-merge / dry-run などの誤判定は避けたい
  if (!/\bgit\s+push\b/.test(command)) return false;
  // VibePro CLI 内部 spawn は別 process で hook対象外
  return true;
}

function getCurrentBranch(): string {
  try {
    return execFileSync("git", ["branch", "--show-current"], {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch {
    return "";
  }
}

function isSessionBranch(branch: string): boolean {
  return branch.startsWith("session/") || branch.startsWith("feat/") || branch.startsWith("fix/");
}

function findVibeproBin(): string | null {
  const candidates = [
    "/Users/ksato/workspace/code/vibepro/bin/vibepro.js",
  ];
  for (const p of candidates) if (existsSync(p)) return p;
  return null;
}

function checkGate(): { passed: boolean; reason?: string } {
  if (process.env.BRAINBASE_ALLOW_PUSH_WITHOUT_GATE === "1") {
    return { passed: true, reason: "BRAINBASE_ALLOW_PUSH_WITHOUT_GATE=1" };
  }

  const branch = getCurrentBranch();
  if (!branch) return { passed: true, reason: "branch unknown, skip" };
  if (!isSessionBranch(branch)) return { passed: true, reason: `non-session branch: ${branch}` };

  const vibeproBin = findVibeproBin();
  if (!vibeproBin) return { passed: true, reason: "vibepro CLI not found, skip" };

  const result = spawnSync("node", [vibeproBin, "pr", "prepare", ".", "--base", "origin/develop", "--json"], {
    cwd: process.cwd(),
    encoding: "utf8",
    timeout: 30000,
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.status !== 0) {
    return { passed: false, reason: `vibepro pr prepare failed: ${result.stderr?.slice(0, 200) ?? ""}` };
  }

  try {
    const out = result.stdout ?? "";
    const start = out.indexOf("{");
    if (start < 0) return { passed: true, reason: "no JSON output, skip" };
    const json = JSON.parse(out.slice(start));
    const status = json?.pr_context?.gate_dag?.overall_status;
    if (status === "ready_for_review") return { passed: true, reason: status };
    return { passed: false, reason: `gate_dag.overall_status = ${status}` };
  } catch (e) {
    return { passed: true, reason: `parse error, skip: ${(e as Error).message}` };
  }
}

async function main() {
  try {
    const inputString = process.argv[2];
    const input: BashToolInput = JSON.parse(inputString);

    if (input.tool !== "Bash") {
      console.log(JSON.stringify({ permissionDecision: "allow", blocked: false }));
      return;
    }

    const command = input.parameters?.command ?? "";
    if (!isGitPushCommand(command)) {
      console.log(JSON.stringify({ permissionDecision: "allow", blocked: false }));
      return;
    }

    const gate = checkGate();
    logHookExecution("PreToolUse", "git-push-gate", `passed=${gate.passed} reason=${gate.reason ?? ""}`);

    if (gate.passed) {
      console.log(JSON.stringify({ permissionDecision: "allow", blocked: false }));
      return;
    }

    const message = [
      "❌ VibePro DAG ガード: git push がブロックされました",
      "",
      `理由: ${gate.reason}`,
      "",
      "対処:",
      "  1. Unit / Integration / E2E test を追加して各 gate に証跡を残す",
      "  2. `node /Users/ksato/workspace/code/vibepro/bin/vibepro.js pr prepare . --base origin/develop` で gate_dag 確認",
      "  3. ready_for_review に到達してから再 push",
      "",
      "緊急時の escape:",
      "  BRAINBASE_ALLOW_PUSH_WITHOUT_GATE=1 を export",
      "  （PR本文に bypass 理由を残すこと）",
    ].join("\n");

    console.error(message);
    const hookResult: HookResult = {
      permissionDecision: "deny",
      blocked: true,
      reason: message,
    };
    console.log(JSON.stringify(hookResult));
    process.exit(1);
  } catch (error) {
    // hook 自身のエラーで push を止めない（fail-open）
    console.error("git-push-gate hook error:", error instanceof Error ? error.message : String(error));
    console.log(JSON.stringify({ permissionDecision: "allow", blocked: false }));
    process.exit(0);
  }
}

if (process.argv[1] === import.meta.url.replace("file://", "")) {
  main().catch((error) => {
    console.error("git-push-gate fatal:", error);
    console.log(JSON.stringify({ permissionDecision: "allow", blocked: false }));
    process.exit(0);
  });
}
