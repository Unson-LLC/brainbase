#!/usr/bin/env npx tsx

/**
 * コンテキストローダーフック（薄いラッパー）
 *
 * lib/config/context-loader.tsのエントリーポイント
 * ユーザープロンプト送信時に自動コンテキスト読み込み
 */

async function main() {
  try {
    const { execSync } = await import("child_process");
    execSync("npx tsx .claude/scripts/lib/config/context-loader.ts", {
      stdio: "inherit",
    });

    process.exit(0);
  } catch (error) {
    console.error(
      "❌ コンテキストローダーフック実行エラー:",
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
