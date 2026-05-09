#!/usr/bin/env npx tsx

/**
 * 禁止コマンドチェックフック（薄いラッパー）
 *
 * lib/file-system/forbidden-commands.tsのエントリーポイント
 */

import { CommandChecker } from "../../lib/file-system/forbidden-commands.js";
import type {
  BashToolInput,
  HookResult,
} from "../../../../src/types/hooks/bash-validation.js";
import { logHookExecution } from "../../lib/logging/hook-logger.js";

async function main() {
  try {
    const inputString = process.argv[2];

    const input: BashToolInput = JSON.parse(inputString);

    if (input.tool !== "Bash") {
      console.log(
        JSON.stringify({
          permissionDecision: "allow",
          blocked: false,
        }),
      );
      process.exit(0);
    }

    const command = input.parameters.command;

    const checker = new CommandChecker();
    const result = checker.checkCommand(command);

    if (!result.allowed) {
      logHookExecution(
        "PreToolUse",
        "forbidden-command-blocked",
        `コマンドブロック: ${command}`,
      );
      await checker.displayError(command, result.message || "不明なエラー");

      const hookResult: HookResult = {
        permissionDecision: "deny",
        blocked: true,
        reason: result.message || "禁止されたコマンドです",
      };

      console.log(JSON.stringify(hookResult, null, 2));
      process.exit(1);
    }

    if (result.isWarning && result.message) {
      logHookExecution(
        "PreToolUse",
        "forbidden-command-warning",
        `警告: ${command}`,
      );
      checker.displayWarning(command, result.message);
    } else {
      logHookExecution(
        "PreToolUse",
        "forbidden-command-allowed",
        `許可: ${command}`,
      );
    }

    const hookResult: HookResult = {
      permissionDecision: "allow",
      blocked: false,
    };

    console.log(JSON.stringify(hookResult, null, 2));
    process.exit(0);
  } catch (error) {
    console.error(
      "❌ 禁止コマンドチェック実行エラー:",
      error instanceof Error ? error.message : String(error),
    );
    console.error("❌ Stack trace:", error instanceof Error ? error.stack : "");

    const hookResult: HookResult = {
      permissionDecision: "deny",
      blocked: true,
      reason: "コマンドチェック処理でエラーが発生しました",
    };

    console.log(JSON.stringify(hookResult, null, 2));
    process.exit(1);
  }
}

// Hook entry point
if (process.argv[1] === import.meta.url.replace("file://", "")) {
  main().catch((error) => {
    console.error("❌ フック実行エラー:", error);
    process.exit(1);
  });
}
