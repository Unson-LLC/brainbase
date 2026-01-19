#!/usr/bin/env npx tsx

/**
 * 作業完了通知フック（薄いラッパー）
 *
 * lib/notification/notifier.tsのエントリーポイント
 * Claude Code停止時に作業完了通知を実行
 */

async function main() {
  try {
    const { execSync } = await import("child_process");
    execSync(
      'npx tsx .claude/scripts/lib/notification/notifier.ts complete "作業完了 - ユーザーアクション待ち"',
      { stdio: "inherit" },
    );

    process.exit(0);
  } catch (error) {
    console.error(
      "❌ 作業完了通知フック実行エラー:",
      error instanceof Error ? error.message : String(error),
    );
    // Stopフックなのでエラーでも処理は継続
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
