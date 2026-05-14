#!/usr/bin/env npx tsx
/**
 * PreToolUseフック自動テストスクリプト
 */

import { execFileSync, execSync } from "child_process";
import * as fs from "fs";

interface TestResult {
  hook: string;
  tool: string;
  success: boolean;
  output: string;
  error?: string;
}

const results: TestResult[] = [];

function runPreToolUseHook(input: unknown): string {
  return execFileSync(
    "npx",
    [
      "tsx",
      ".claude/scripts/hooks/pre-tool-use/forbidden-commands-wrapper.ts",
      JSON.stringify(input),
    ],
    { encoding: "utf8", timeout: 10000 },
  );
}

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

// 1.1. Graph API direct curl guard: required headers missing
console.log("\n1.1️⃣ Graph APIヘッダー不足ブロックテスト実行中...");
try {
  const output = runPreToolUseHook({
    tool: "Bash",
    parameters: {
      command:
        "curl -sS -H 'Authorization: Bearer token' 'https://bb.unson.jp/api/info/graph/entities?type=decision&limit=500'",
    },
  });
  results.push({
    hook: "forbidden-commands-wrapper.ts",
    tool: "Bash(Graph API headers missing)",
    success: false,
    output: output.trim(),
    error: "Graph APIヘッダー不足のcurlが許可されました",
  });
  console.log("❌ Graph APIヘッダー不足ブロック: 失敗");
} catch (error: any) {
  const output = `${error.stdout || ""}\n${error.stderr || ""}`;
  const blocked =
    error.status !== 0 &&
    output.includes("Graph API") &&
    output.includes("x-brainbase-role");
  results.push({
    hook: "forbidden-commands-wrapper.ts",
    tool: "Bash(Graph API headers missing)",
    success: blocked,
    output: output.trim(),
    error: blocked ? undefined : error.stderr || error.message,
  });
  console.log(
    blocked
      ? "✅ Graph APIヘッダー不足ブロック: 成功"
      : "❌ Graph APIヘッダー不足ブロック: 失敗",
  );
}

// 1.2. Graph API direct curl guard: required headers present
console.log("\n1.2️⃣ Graph APIヘッダー付き許可テスト実行中...");
try {
  const output = runPreToolUseHook({
    tool: "Bash",
    parameters: {
      command:
        'TOKEN=$(cat ~/.brainbase/tokens.json | jq -r .access_token); curl -sS -H "Authorization: Bearer $TOKEN" -H "x-brainbase-role: gm" -H "x-brainbase-projects: brainbase,unson,salestailor" -H "x-brainbase-clearance: internal,restricted,finance,hr,contract" "https://bb.unson.jp/api/info/graph/entities?type=decision&limit=500"',
    },
  });
  const allowed = output.includes('"permissionDecision": "allow"');
  results.push({
    hook: "forbidden-commands-wrapper.ts",
    tool: "Bash(Graph API headers present)",
    success: allowed,
    output: output.trim(),
    error: allowed ? undefined : "Graph APIヘッダー付きcurlが許可されませんでした",
  });
  console.log(
    allowed
      ? "✅ Graph APIヘッダー付き許可: 成功"
      : "❌ Graph APIヘッダー付き許可: 失敗",
  );
} catch (error: any) {
  results.push({
    hook: "forbidden-commands-wrapper.ts",
    tool: "Bash(Graph API headers present)",
    success: false,
    output: error.stdout || "",
    error: error.stderr || error.message,
  });
  console.log("❌ Graph APIヘッダー付き許可: 失敗");
}

// 1.3. Graph API direct curl guard: jq without .error check
console.log("\n1.3️⃣ Graph API jqエラー未検査ブロックテスト実行中...");
try {
  const output = runPreToolUseHook({
    tool: "Bash",
    parameters: {
      command:
        'TOKEN=$(cat ~/.brainbase/tokens.json | jq -r .access_token); curl -sS -H "Authorization: Bearer $TOKEN" -H "x-brainbase-role: gm" -H "x-brainbase-projects: brainbase,unson,salestailor" -H "x-brainbase-clearance: internal,restricted,finance,hr,contract" "https://bb.unson.jp/api/info/graph/entities?type=decision&limit=500" | jq -r \'.records[] | .payload.title\'',
    },
  });
  results.push({
    hook: "forbidden-commands-wrapper.ts",
    tool: "Bash(Graph API jq without error check)",
    success: false,
    output: output.trim(),
    error: "Graph APIのjqエラー未検査curlが許可されました",
  });
  console.log("❌ Graph API jqエラー未検査ブロック: 失敗");
} catch (error: any) {
  const output = `${error.stdout || ""}\n${error.stderr || ""}`;
  const blocked =
    error.status !== 0 &&
    output.includes("Graph API") &&
    output.includes(".error");
  results.push({
    hook: "forbidden-commands-wrapper.ts",
    tool: "Bash(Graph API jq without error check)",
    success: blocked,
    output: output.trim(),
    error: blocked ? undefined : error.stderr || error.message,
  });
  console.log(
    blocked
      ? "✅ Graph API jqエラー未検査ブロック: 成功"
      : "❌ Graph API jqエラー未検査ブロック: 失敗",
  );
}

// 1.4. Graph API direct curl guard: jq with .error check
console.log("\n1.4️⃣ Graph API jqエラー検査付き許可テスト実行中...");
try {
  const output = runPreToolUseHook({
    tool: "Bash",
    parameters: {
      command:
        'TOKEN=$(cat ~/.brainbase/tokens.json | jq -r .access_token); curl -sS -H "Authorization: Bearer $TOKEN" -H "x-brainbase-role: gm" -H "x-brainbase-projects: brainbase,unson,salestailor" -H "x-brainbase-clearance: internal,restricted,finance,hr,contract" "https://bb.unson.jp/api/info/graph/entities?type=decision&limit=500" | jq \'if .error then error(.error) else .records[] | .payload.title end\'',
    },
  });
  const allowed = output.includes('"permissionDecision": "allow"');
  results.push({
    hook: "forbidden-commands-wrapper.ts",
    tool: "Bash(Graph API jq with error check)",
    success: allowed,
    output: output.trim(),
    error: allowed
      ? undefined
      : "Graph APIのjqエラー検査付きcurlが許可されませんでした",
  });
  console.log(
    allowed
      ? "✅ Graph API jqエラー検査付き許可: 成功"
      : "❌ Graph API jqエラー検査付き許可: 失敗",
  );
} catch (error: any) {
  results.push({
    hook: "forbidden-commands-wrapper.ts",
    tool: "Bash(Graph API jq with error check)",
    success: false,
    output: error.stdout || "",
    error: error.stderr || error.message,
  });
  console.log("❌ Graph API jqエラー検査付き許可: 失敗");
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
