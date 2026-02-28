#!/usr/bin/env npx tsx
/**
 * PreToolUseフック自動テストスクリプト
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

console.log("🧪 PreToolUseフック自動テスト開始\n");

// 1. forbidden-commands-wrapper.ts のテスト (Bash)
console.log("1️⃣ forbidden-commands-wrapper.ts テスト実行中...");
try {
  const dummyInput = JSON.stringify({
    tool: "Bash",
    parameters: { command: "ls -la" },
  });
  
  const output = execSync(
    `npx tsx .claude/scripts/hooks/pre-tool-use/forbidden-commands-wrapper.ts '${dummyInput}'`,
    { encoding: "utf8", timeout: 10000 }
  );
  results.push({
    hook: "forbidden-commands-wrapper.ts",
    tool: "Bash",
    success: true,
    output: output.trim(),
  });
  console.log("✅ forbidden-commands-wrapper.ts: 成功");
} catch (error: any) {
  results.push({
    hook: "forbidden-commands-wrapper.ts",
    tool: "Bash",
    success: false,
    output: error.stdout || "",
    error: error.stderr || error.message,
  });
  console.log("❌ forbidden-commands-wrapper.ts: 失敗");
}

// 2. serena-enforcement-wrapper.ts のテスト (Read)
console.log("\n2️⃣ serena-enforcement-wrapper.ts テスト実行中...");
try {
  const dummyInput = JSON.stringify({
    tool: "Read",
    parameters: { file_path: "/tmp/test.txt" },
  });
  
  const output = execSync(
    `npx tsx .claude/scripts/hooks/pre-tool-use/serena-enforcement-wrapper.ts '${dummyInput}'`,
    { encoding: "utf8", timeout: 10000 }
  );
  results.push({
    hook: "serena-enforcement-wrapper.ts",
    tool: "Read",
    success: true,
    output: output.trim(),
  });
  console.log("✅ serena-enforcement-wrapper.ts: 成功");
} catch (error: any) {
  results.push({
    hook: "serena-enforcement-wrapper.ts",
    tool: "Read",
    success: false,
    output: error.stdout || "",
    error: error.stderr || error.message,
  });
  console.log("❌ serena-enforcement-wrapper.ts: 失敗");
}

// 3. edit-comprehensive-validator.ts のテスト (Edit|Write|MultiEdit)
console.log("\n3️⃣ edit-comprehensive-validator.ts テスト実行中...");
try {
  const dummyInput = JSON.stringify({
    tool: "Edit",
    parameters: {
      file_path: "/tmp/test.ts",
      old_string: "test",
      new_string: "test2",
    },
  });
  
  const output = execSync(
    `npx tsx .claude/scripts/hooks/pre-tool-use/edit-comprehensive-validator.ts '${dummyInput}'`,
    { encoding: "utf8", timeout: 30000 }
  );
  results.push({
    hook: "edit-comprehensive-validator.ts",
    tool: "Edit|Write|MultiEdit",
    success: true,
    output: output.trim(),
  });
  console.log("✅ edit-comprehensive-validator.ts: 成功");
} catch (error: any) {
  results.push({
    hook: "edit-comprehensive-validator.ts",
    tool: "Edit|Write|MultiEdit",
    success: false,
    output: error.stdout || "",
    error: error.stderr || error.message,
  });
  console.log("❌ edit-comprehensive-validator.ts: 失敗");
}

// テスト結果サマリー
console.log("\n" + "=".repeat(60));
console.log("📊 PreToolUseフックテスト結果サマリー");
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
const reportPath = ".claude/output/reports/pre-tool-use-hook-test-report.md";
const report = `# PreToolUseフック自動テストレポート

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
    ? "🎉 全てのPreToolUseフックが正常に動作しています。"
    : `⚠️ ${totalCount - successCount}個のフックに問題があります。エラー詳細を確認し、修正してください。`
}

---
*このレポートは自動生成されました*
`;

fs.mkdirSync(".claude/output/reports", { recursive: true });
fs.writeFileSync(reportPath, report, "utf-8");
console.log(`\n📄 テストレポート生成: ${reportPath}`);

process.exit(successCount === totalCount ? 0 : 1);
