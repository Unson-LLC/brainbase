#!/usr/bin/env npx tsx

/**
 * 環境セクション挿入フック（薄いラッパー）
 *
 * lib/config/env-section-injector.tsのエントリーポイント
 * ユーザープロンプト送信時に環境構成セクションを自動挿入
 */

async function main() {
  try {
    const { execSync } = await import("child_process");
    execSync("npx tsx .claude/scripts/lib/config/env-section-injector.ts", {
      stdio: "inherit",
    });

    process.exit(0);
  } catch (error) {
    console.error(
      "❌ 環境セクション挿入フック実行エラー:",
      error instanceof Error ? error.message : String(error),
    );
    // UserPromptSubmitフックなのでエラーでも処理は継続
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
