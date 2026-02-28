#!/usr/bin/env npx tsx

/**
 * PostToolUse Edit検証フック（薄いラッパー）
 *
 * core/quality/edit-validator.tsのエントリーポイント
 */

import main from "../../core/quality/edit-validator.js";
import { logHookExecution } from "../../lib/logging/hook-logger.js";

// Hook entry point
if (process.argv[1] === import.meta.url.replace("file://", "")) {
  // $CLAUDE_TOOL_INPUT を取得
  const toolInput = process.argv[2] || "{}";

  logHookExecution(
    "PostToolUse",
    "EDIT-VALIDATOR-START",
    `検証開始 - Input: ${toolInput.slice(0, 100)}`
  );

  main()
    .then((result) => {
      logHookExecution(
        "PostToolUse",
        "EDIT-VALIDATOR-COMPLETE",
        `検証完了 - ${JSON.stringify(result).slice(0, 200)}`
      );
    })
    .catch((error: unknown) => {
      logHookExecution(
        "PostToolUse",
        "EDIT-VALIDATOR-ERROR",
        `エラー - ${String(error).slice(0, 200)}`
      );
      console.error("❌ Edit検証実行エラー:", error);
      process.exit(1);
    });
}
