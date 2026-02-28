#!/usr/bin/env npx tsx

/**
 * 検証トラッカーフック（薄いラッパー）
 *
 * core/monitoring/verification-tracker.tsのエントリーポイント
 * 全ツール実行後にメトリクスを記録
 */

async function main() {
  try {
    // verification-trackerは$CLAUDE_TOOL_INPUTを使用しないため、
    // 引数なしで直接実行
    const { execSync } = await import("child_process");
    execSync("npx tsx .claude/scripts/core/monitoring/verification-tracker.ts", {
      stdio: "inherit",
    });

    process.exit(0);
  } catch (error) {
    console.error(
      "❌ 検証トラッカーフック実行エラー:",
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
