#!/usr/bin/env npx tsx

/**
 * Git操作通知フック（薄いラッパー）
 *
 * lib/notification/notifier.tsのエントリーポイント
 * git commit/push成功時に音声通知を実行
 */

import type { BashToolInput } from "../../../../src/types/hooks/bash-validation.js";
import { logHookExecution } from "../../lib/logging/hook-logger.js";

async function main() {
  try {
    const rawInput = process.argv[2] || "{}";
    logHookExecution(
      "PostToolUse",
      "git-notification-raw",
      `Raw input: ${rawInput.substring(0, 200)}`,
    );

    const input: BashToolInput = JSON.parse(rawInput);
    const command = input.parameters?.command || "unknown";
    logHookExecution(
      "PostToolUse",
      "git-notification",
      `Bashコマンド: ${command}`,
    );

    if (input.tool !== "Bash") {
      // Bash以外は何もしない
      process.exit(0);
    }

    // git commit検出
    if (command.includes("git commit")) {
      logHookExecution(
        "PostToolUse",
        "git-commit-detected",
        "git commit実行を検出",
      );
      const { execSync } = await import("child_process");
      execSync("npx tsx .claude/scripts/lib/notification/notifier.ts commit", {
        stdio: "inherit",
      });
    }

    // git push検出
    if (command.includes("git push")) {
      logHookExecution(
        "PostToolUse",
        "git-push-detected",
        "git push実行を検出",
      );
      const { execSync } = await import("child_process");
      execSync("npx tsx .claude/scripts/lib/notification/notifier.ts push", {
        stdio: "inherit",
      });
    }

    process.exit(0);
  } catch (error) {
    console.error(
      "❌ Git通知フック実行エラー:",
      error instanceof Error ? error.message : String(error),
    );
    // PostToolUseフックなのでエラーでも処理は継続
    process.exit(0);
  }
}

// Hook entry point
if (process.argv[1] === import.meta.url.replace("file://", "")) {
  main().catch((error) => {
    console.error("❌ フック実行エラー:", error);
    process.exit(0);
  });
}
