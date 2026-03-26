#!/usr/bin/env npx tsx

/**
 * 環境セクション挿入フック（薄いラッパー）
 *
 * lib/config/env-section-injector.tsのエントリーポイント
 * ユーザープロンプト送信時に環境構成セクションを自動挿入
 */

async function main() {
  try {
    const { execFileSync } = await import("child_process");
    const { fileURLToPath } = await import("url");
    const path = await import("path");
    const wrapperPath = fileURLToPath(import.meta.url);
    const targetPath = path.resolve(path.dirname(wrapperPath), "../../lib/config/env-section-injector.ts");
    execFileSync("npx", ["tsx", targetPath], {
      stdio: "inherit",
      cwd: process.cwd(),
    });

    process.exit(0);
  } catch (error) {
    console.error(
      "❌ 環境セクション挿入フック実行エラー:",
      error instanceof Error ? error.message : String(error),
    );
    process.exit(0);
  }
}

if (process.argv[1] === import.meta.url.replace("file://", "")) {
  main().catch((error) => {
    console.error("❌ フック実行エラー:", error);
    process.exit(0);
  });
}
