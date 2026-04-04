#!/usr/bin/env npx tsx
/**
 * PostToolUseフック自動テストスクリプト
 */

import { execSync } from "child_process";
import * as fs from "fs";

interface TestResult {
  hook: string;
  tool: string;
  success: boolean;
  output: string;
  error?: string;
}

const results: TestResult[] = [];

console.log("🧪 PostToolUseフック自動テスト開始\n");

// 1. edit-validator.ts のテスト (Write|Edit|MultiEdit)
console.log("1️⃣ edit-validator.ts テスト実行中...");
try {
  const output = execSync(
    "npx tsx .claude/scripts/hooks/post-tool-use/edit-validator.ts",
    { encoding: "utf8", timeout: 20000 }
  );
  results.push({
    hook: "edit-validator.ts",
    tool: "Write|Edit|MultiEdit",
    success: true,
    output: output.trim(),
  });
  console.log("✅ edit-validator.ts: 成功");
} catch (error: any) {
  results.push({
    hook: "edit-validator.ts",
    tool: "Write|Edit|MultiEdit",
    success: false,
    output: error.stdout || "",
    error: error.stderr || error.message,
  });
  console.log("❌ edit-validator.ts: 失敗");
}

// 2. read-tool-warning-wrapper.ts のテスト (Read)
console.log("\n2️⃣ read-tool-warning-wrapper.ts テスト実行中...");
try {
  // コードファイルへのReadツール入力を作成
  const dummyInput = JSON.stringify({
    tool: "Read",
    parameters: { file_path: "src/app/test.ts" },
  });

  const output = execSync(
    `npx tsx .claude/scripts/hooks/post-tool-use/read-tool-warning-wrapper.ts '${dummyInput}'`,
    { encoding: "utf8", timeout: 5000 }
  );
  results.push({
    hook: "read-tool-warning-wrapper.ts",
    tool: "Read",
    success: true,
    output: output.trim(),
  });
  console.log("✅ read-tool-warning-wrapper.ts: 成功");
} catch (error: any) {
  results.push({
    hook: "read-tool-warning-wrapper.ts",
    tool: "Read",
    success: false,
    output: error.stdout || "",
    error: error.stderr || error.message,
  });
  console.log("❌ read-tool-warning-wrapper.ts: 失敗");
}

// 3. git-notification-wrapper.ts のテスト (Bash)
console.log("\n3️⃣ git-notification-wrapper.ts テスト実行中...");
try {
  // ダミーのBashツール入力を作成
  const dummyInput = JSON.stringify({
    tool: "Bash",
    parameters: { command: "echo test" },
  });

  const output = execSync(
    `npx tsx .claude/scripts/hooks/post-tool-use/git-notification-wrapper.ts '${dummyInput}'`,
    { encoding: "utf8", timeout: 5000 }
  );
  results.push({
    hook: "git-notification-wrapper.ts",
    tool: "Bash",
    success: true,
    output: output.trim(),
  });
  console.log("✅ git-notification-wrapper.ts: 成功");
} catch (error: any) {
  results.push({
    hook: "git-notification-wrapper.ts",
    tool: "Bash",
    success: false,
    output: error.stdout || "",
    error: error.stderr || error.message,
  });
  console.log("❌ git-notification-wrapper.ts: 失敗");
}

// 4. requirement-checker-wrapper.ts のテスト (TodoWrite)
console.log("\n4️⃣ requirement-checker-wrapper.ts テスト実行中...");
try {
  const dummyInput = JSON.stringify({
    tool: "TodoWrite",
    parameters: {
      todos: [
        { content: "Test task", status: "completed", activeForm: "Testing" }
      ]
    },
  });
  
  const output = execSync(
    `npx tsx .claude/scripts/hooks/post-tool-use/requirement-checker-wrapper.ts '${dummyInput}'`,
    { encoding: "utf8", timeout: 30000 }
  );
  results.push({
    hook: "requirement-checker-wrapper.ts",
    tool: "TodoWrite",
    success: true,
    output: output.trim(),
  });
  console.log("✅ requirement-checker-wrapper.ts: 成功");
} catch (error: any) {
  results.push({
    hook: "requirement-checker-wrapper.ts",
    tool: "TodoWrite",
    success: false,
    output: error.stdout || "",
    error: error.stderr || error.message,
  });
  console.log("❌ requirement-checker-wrapper.ts: 失敗");
}

// 5. verification-tracker-wrapper.ts のテスト (.* 全ツール)
console.log("\n5️⃣ verification-tracker-wrapper.ts テスト実行中...");
try {
  const output = execSync(
    "npx tsx .claude/scripts/hooks/post-tool-use/verification-tracker-wrapper.ts",
    { encoding: "utf8", timeout: 5000 }
  );
  results.push({
    hook: "verification-tracker-wrapper.ts",
    tool: ".*",
    success: true,
    output: output.trim(),
  });
  console.log("✅ verification-tracker-wrapper.ts: 成功");
} catch (error: any) {
  results.push({
    hook: "verification-tracker-wrapper.ts",
    tool: ".*",
    success: false,
    output: error.stdout || "",
    error: error.stderr || error.message,
  });
  console.log("❌ verification-tracker-wrapper.ts: 失敗");
}

// 6. activity-bridge.ts のテスト (.* 全ツール)
console.log("\n6️⃣ activity-bridge.ts テスト実行中...");
try {
  const dummyInput = JSON.stringify({
    tool: "Bash",
    parameters: { command: "echo test" },
  });

  const output = execSync(
    `npx tsx .claude/scripts/hooks/post-tool-use/activity-bridge.ts '${dummyInput}'`,
    {
      encoding: "utf8",
      timeout: 5000,
      env: {
        ...process.env,
        BRAINBASE_PORT: "9",
        BRAINBASE_SESSION_ID: "session-hook-test",
      },
    }
  );
  results.push({
    hook: "activity-bridge.ts",
    tool: ".*",
    success: true,
    output: output.trim(),
  });
  console.log("✅ activity-bridge.ts: 成功");
} catch (error: any) {
  results.push({
    hook: "activity-bridge.ts",
    tool: ".*",
    success: false,
    output: error.stdout || "",
    error: error.stderr || error.message,
  });
  console.log("❌ activity-bridge.ts: 失敗");
}

// 7. interrupt-detector.ts のテスト (.* 全ツール)
console.log("\n7️⃣ interrupt-detector.ts テスト実行中...");
try {
  const output = execSync(
    "npx tsx .claude/scripts/hooks/post-tool-use/interrupt-detector.ts",
    { encoding: "utf8", timeout: 3000 }
  );
  results.push({
    hook: "interrupt-detector.ts",
    tool: ".*",
    success: true,
    output: output.trim(),
  });
  console.log("✅ interrupt-detector.ts: 成功");
} catch (error: any) {
  results.push({
    hook: "interrupt-detector.ts",
    tool: ".*",
    success: false,
    output: error.stdout || "",
    error: error.stderr || error.message,
  });
  console.log("❌ interrupt-detector.ts: 失敗");
}

// テスト結果サマリー
console.log("\n" + "=".repeat(60));
console.log("📊 PostToolUseフックテスト結果サマリー");
console.log("=".repeat(60));

const successCount = results.filter((r) => r.success).length;
const totalCount = results.length;

console.log(`\n総合結果: ${successCount}/${totalCount} 成功\n`);

results.forEach((result, index) => {
  const icon = result.success ? "✅" : "❌";
  console.log(`${icon} ${index + 1}. ${result.hook} (${result.tool})`);
  if (!result.success && result.error) {
    console.log(`   エラー: ${result.error.slice(0, 200)}`);
  }
});

// レポート生成
const reportPath = ".claude/output/reports/post-tool-use-hook-test-report.md";
const report = `# PostToolUseフック自動テストレポート

## 実行日時
${new Date().toISOString()}

## テスト結果サマリー
**成功率**: ${successCount}/${totalCount} (${((successCount / totalCount) * 100).toFixed(1)}%)

## 詳細結果

${results
  .map(
    (result, index) => `
### ${index + 1}. ${result.hook}
- **ツールマッチャー**: ${result.tool}
- **結果**: ${result.success ? "✅ 成功" : "❌ 失敗"}
${result.success ? "" : `- **エラー**: ${result.error || "N/A"}`}
- **出力**:
\`\`\`
${result.output.slice(0, 500)}
\`\`\`
`
  )
  .join("\n")}

## 推奨アクション
${
  successCount === totalCount
    ? "🎉 全てのPostToolUseフックが正常に動作しています。"
    : `⚠️ ${totalCount - successCount}個のフックに問題があります。エラー詳細を確認し、修正してください。`
}

---
*このレポートは自動生成されました*
`;

fs.mkdirSync(".claude/output/reports", { recursive: true });
fs.writeFileSync(reportPath, report, "utf-8");
console.log(`\n📄 テストレポート生成: ${reportPath}`);

process.exit(successCount === totalCount ? 0 : 1);
