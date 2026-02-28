#!/usr/bin/env npx tsx

/**
 * 要件チェッカーフック（薄いラッパー）
 *
 * core/verification/requirement-checker.tsのエントリーポイント
 * 複数タスク完了時に受け入れ基準を自動チェック
 */

import type { TodoWriteInput } from "../../../../src/types/hooks/common.js";

async function main() {
  try {
    const input: TodoWriteInput = JSON.parse(process.argv[2]);

    if (input.tool !== "TodoWrite") {
      // TodoWrite以外は何もしない
      process.exit(0);
    }

    const todos = input.parameters.todos;

    // 3つ以上のcompleted検出（複数タスク完了時）
    const completedCount = todos.filter((t) => t.status === "completed").length;

    if (completedCount >= 3) {
      const { execSync } = await import("child_process");
      execSync(
        "npx tsx .claude/scripts/core/verification/requirement-checker.ts --auto-fix",
        { stdio: "inherit" },
      );
    }

    process.exit(0);
  } catch (error) {
    console.error(
      "❌ 要件チェッカーフック実行エラー:",
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
