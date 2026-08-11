#!/usr/bin/env npx tsx

/**
 * git push gate: canonical VibePro runtimeとpr prepare identityを検証してpushを許可する。
 *
 * 効力:
 * - Claude Code Bash tool で `git push ...` を実行しようとした時に発火
 * - exact npm runtimeまたはpr prepare identityを検証できなければdeny
 *
 * escape:
 * - BRAINBASE_ALLOW_PUSH_WITHOUT_GATE=1 を export
 * - non session/* branch は skip
 *
 * 配置: settings.json の PreToolUse Bash matcher（forbidden-commands の後）
 */

import { execFileSync, spawnSync } from "child_process";
import path from "node:path";
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

function getRepoRoot(): string {
  return execFileSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function checkGate(): { passed: boolean; reason?: string } {
  const root = getRepoRoot();
  const contract = path.join(root, ".claude/scripts/hooks/lib/vibepro-runtime-contract.mjs");
  const identityResult = spawnSync(process.execPath, [contract, "identity", "--cwd", root], {
    cwd: root,
    encoding: "utf8",
    timeout: 30000,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (identityResult.status !== 0) {
    return { passed: false, reason: `canonical runtime identity failed: ${identityResult.stderr?.slice(0, 400) ?? ""}` };
  }
  const identity = JSON.parse(identityResult.stdout ?? "{}").runtime_identity;
  const identitySummary = `${identity.package.exact_version} source=${identity.source_git.commit} identity=${identity.identity_digest}`;

  if (process.env.BRAINBASE_ALLOW_PUSH_WITHOUT_GATE === "1") {
    return { passed: true, reason: `BRAINBASE_ALLOW_PUSH_WITHOUT_GATE=1; runtime ${identitySummary}` };
  }

  const branch = getCurrentBranch();
  if (!branch) return { passed: false, reason: `branch unknown; runtime ${identitySummary}` };
  if (!isSessionBranch(branch)) return { passed: true, reason: `non-session branch: ${branch}; runtime ${identitySummary}` };

  const result = spawnSync(process.execPath, [contract, "pr-prepare", "--cwd", root, "--base", "origin/develop"], {
    cwd: root,
    encoding: "utf8",
    timeout: 30000,
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.status !== 0) {
    return { passed: false, reason: `canonical pr prepare failed: ${result.stderr?.slice(0, 400) ?? ""}` };
  }

  try {
    const json = JSON.parse(result.stdout ?? "{}");
    const preparedDigest = json?.runtime_identity?.identity_digest;
    if (preparedDigest !== identity.identity_digest) {
      return { passed: false, reason: "pr prepare runtime identity mismatch" };
    }
    return { passed: true, reason: `pr prepared; runtime ${identitySummary}` };
  } catch (e) {
    return { passed: false, reason: `canonical pr prepare parse error: ${(e as Error).message}` };
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
      console.log(JSON.stringify({ permissionDecision: "allow", blocked: false, reason: gate.reason }));
      return;
    }

    const message = [
      "❌ VibePro runtime integrity guard: git push がブロックされました",
      "",
      `理由: ${gate.reason}`,
      "",
      "対処:",
      "  1. canonical npm版VibeProで必要な検証証跡を再生成する",
      "  2. `vibepro pr prepare . --base origin/develop` を成功させる",
      "",
      "緊急時の escape:",
      "  BRAINBASE_ALLOW_PUSH_WITHOUT_GATE=1 を export",
      "  （runtime identity検証は省略されません。PR本文にbypass理由を残すこと）",
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
    // identityを証明できないhook errorはpushを止める（fail-closed）
    console.error("git-push-gate hook error:", error instanceof Error ? error.message : String(error));
    console.log(JSON.stringify({ permissionDecision: "deny", blocked: true, reason: String(error) }));
    process.exit(1);
  }
}

if (process.argv[1] === import.meta.url.replace("file://", "")) {
  main().catch((error) => {
    console.error("git-push-gate fatal:", error);
    console.log(JSON.stringify({ permissionDecision: "deny", blocked: true, reason: String(error) }));
    process.exit(1);
  });
}
