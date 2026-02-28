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
  console.error("🔍 [DEBUG] forbidden-commands-wrapper.ts が呼び出されました");
  console.error("🔍 [DEBUG] process.argv:", process.argv);

  try {
    const inputString = process.argv[2];
    console.error("🔍 [DEBUG] Raw input:", inputString);

    const input: BashToolInput = JSON.parse(inputString);
    console.error("🔍 [DEBUG] Parsed input:", JSON.stringify(input, null, 2));

    if (input.tool !== "Bash") {
      console.error("🔍 [DEBUG] Not a Bash tool, allowing");
      console.log(
        JSON.stringify({
          permissionDecision: "allow",
          blocked: false,
        }),
      );
      process.exit(0);
    }

    const command = input.parameters.command;
    console.error("🔍 [DEBUG] Command to check:", command);

    const checker = new CommandChecker();
    const result = checker.checkCommand(command);
    console.error("🔍 [DEBUG] Check result:", JSON.stringify(result, null, 2));

    if (!result.allowed) {
      console.error("🔍 [DEBUG] Command is FORBIDDEN, blocking");
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
      console.error("🔍 [DEBUG] Command has WARNING");
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

    console.error("🔍 [DEBUG] Command is ALLOWED");
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
  console.error("🔍 [DEBUG] Hook entry point matched, starting main()");
  main().catch((error) => {
    console.error("❌ フック実行エラー:", error);
    process.exit(1);
  });
} else {
  console.error("🔍 [DEBUG] Hook entry point NOT matched");
  console.error("🔍 [DEBUG] process.argv[1]:", process.argv[1]);
  console.error("🔍 [DEBUG] import.meta.url:", import.meta.url);
}
