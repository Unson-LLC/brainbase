#!/usr/bin/env npx tsx

/**
 * 事実確認チェックリスト強制フック
 *
 * 技術実装前に必須の確認事項をチェックリスト形式で強制確認
 */

import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

import type { VerificationItem } from "../../../../src/types/claude-hooks.js";

const VERIFICATION_CHECKLIST: VerificationItem[] = [
  {
    id: "api_response",
    description: "関連APIエンドポイントの実際のレスポンス構造を確認済み",
    command: "curl -X GET http://localhost:3001/api/batch-jobs/[ID]/plan",
    required: true,
  },
  {
    id: "source_code",
    description: "関連するソースコードを実際に読み取り済み",
    command: "find src -name '*.ts' -o -name '*.tsx' | head -5",
    required: true,
  },
  {
    id: "type_definitions",
    description: "既存の型定義ファイルを確認済み",
    command: "find src -name '*.ts' -exec grep -l 'interface.*Strategy' {} \\;",
    required: true,
  },
  {
    id: "test_cases",
    description: "関連するテストケースの期待動作を確認済み",
    command: "find tests -name '*.test.ts' | head -3",
    required: true,
  },
  {
    id: "database_schema",
    description: "データベーススキーマまたは設定ファイルを確認済み",
    command: "ls prisma/schema.prisma 2>/dev/null || echo 'No schema found'",
    required: false,
  },
];

function generateVerificationReport(): string {
  const timestamp = new Date().toISOString();
  let report = `# 事実確認チェックリスト - ${timestamp}\n\n`;

  VERIFICATION_CHECKLIST.forEach((item) => {
    const status = item.required ? "🔴 必須" : "🟡 推奨";
    report += `## ${item.id}: ${status}\n`;
    report += `**確認内容**: ${item.description}\n\n`;

    if (item.command) {
      report += `**確認コマンド例**:\n`;
      report += `\`\`\`bash\n${item.command}\n\`\`\`\n\n`;
    }

    report += `- [ ] 確認完了\n\n`;
  });

  report += `## 実証済み事実の記録\n\n`;
  report += `**事実確認済み内容**:\n`;
  report += `- [実際に確認した内容をここに記録]\n\n`;
  report += `**推測・分析**:\n`;
  report += `- [論理的推測や経験に基づく判断をここに記録]\n\n`;
  report += `**不明・要確認**:\n`;
  report += `- [確認が必要な項目をここに記録]\n\n`;

  return report;
}

function main() {
  const input = process.env.CLAUDE_TOOL_INPUT || "";
  const toolName = process.env.CLAUDE_TOOL_NAME || "";

  // 技術実装ツールの使用検出
  const isTechnicalImplementation = ["Write", "Edit", "MultiEdit"].includes(
    toolName,
  );

  // APIやデータ構造に関する言及検出
  const hasDataStructureMention =
    /api|endpoint|interface|type|schema|data.*structure/i.test(input);

  if (isTechnicalImplementation && hasDataStructureMention) {
    console.log("🔍 データ構造関連の技術実装が検出されました");
    console.log("📋 事実確認チェックリストを生成します...");

    const report = generateVerificationReport();

    // レポートファイルを生成
    const reportsDir = ".claude/verification-reports";
    if (!fs.existsSync(reportsDir)) {
      fs.mkdirSync(reportsDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const reportFile = path.join(reportsDir, `fact-check-${timestamp}.md`);
    fs.writeFileSync(reportFile, report);

    console.log(`📄 チェックリストを生成しました: ${reportFile}`);
    console.log("");
    console.log("🚨 実装前に以下を必ず実行してください:");
    console.log("");

    VERIFICATION_CHECKLIST.forEach((item) => {
      if (item.required) {
        console.log(`✅ ${item.description}`);
        if (item.command) {
          console.log(`   コマンド例: ${item.command}`);
        }
      }
    });

    console.log("");
    console.log("💡 すべての必須項目を確認してから実装を開始してください");
    console.log("📝 確認した事実は必ず記録してください");
  }

  console.log("✅ 事実確認チェックリスト検証を完了しました");
}

if (require.main === module) {
  main();
}
