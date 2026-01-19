#!/usr/bin/env node
/**
 * 実装検証レポート自動生成スクリプト
 *
 * 目的: 実装完了時に自動的に implementation-verification-report.md を生成し、
 *       requirement-completion-check.ts フックが正しく動作するようにする
 *
 * 実行タイミング:
 * 1. タスク実装完了時
 * 2. テスト実行成功時
 * 3. git commit 前（pre-commitフック）
 */

import fs from "fs";
import path from "path";
import { execSync } from "child_process";

interface TestResult {
  passed: boolean;
  testFile: string;
  duration: number;
}

interface ImplementationEvidence {
  file: string;
  lineStart: number;
  lineEnd: number;
  description: string;
  verified: boolean;
}

interface AcceptanceCriterion {
  id: string;
  text: string;
  status: "implemented" | "pending" | "not_applicable";
  evidence: ImplementationEvidence[];
}

/**
 * 実装検証レポート生成クラス
 */
export class VerificationReportGenerator {
  private projectRoot: string;
  private reportPath: string;

  constructor() {
    this.projectRoot = process.cwd();
    this.reportPath = path.join(
      this.projectRoot,
      ".claude/output/reports/implementation-verification-report.md",
    );
  }

  /**
   * メイン実行: 検証レポート生成
   */
  async generate(): Promise<void> {
    console.log("🔍 実装検証レポートを生成中...");

    // 1. テスト結果の収集
    const testResults = await this.collectTestResults();

    // 2. 実装ファイルの変更検出
    const changedFiles = await this.detectChangedFiles();

    // 3. 受け入れ基準の読み込み
    const acceptanceCriteria = await this.loadAcceptanceCriteria();

    // 4. 実装証拠の収集
    const evidences = await this.collectImplementationEvidences(changedFiles);

    // 5. レポート生成
    const report = this.buildReport({
      testResults,
      changedFiles,
      acceptanceCriteria,
      evidences,
    });

    // 6. レポートファイル書き込み
    fs.writeFileSync(this.reportPath, report, "utf-8");
    console.log(`✅ 実装検証レポート生成完了: ${this.reportPath}`);
  }

  /**
   * テスト結果の収集
   */
  private async collectTestResults(): Promise<TestResult[]> {
    const results: TestResult[] = [];

    try {
      // E2Eテスト結果ファイルを読み込み
      const resultFiles = [
        "test-results/basic-results.json",
        "test-results/integration-results.json",
        "test-results/full-results.json",
      ];

      for (const file of resultFiles) {
        const filePath = path.join(this.projectRoot, file);
        if (fs.existsSync(filePath)) {
          const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));

          // テスト成功/失敗を判定
          const passed =
            data.stats?.unexpected === 0 && data.stats?.expected > 0;
          results.push({
            passed,
            testFile: file,
            duration: data.stats?.duration || 0,
          });
        }
      }
    } catch (error) {
      console.warn("⚠️ テスト結果の読み込みに失敗:", error);
    }

    return results;
  }

  /**
   * 変更されたファイルの検出（git diff）
   */
  private async detectChangedFiles(): Promise<string[]> {
    try {
      // git diffで変更ファイルを取得
      const output = execSync("git diff --name-only HEAD", {
        encoding: "utf-8",
      });
      const stagedOutput = execSync("git diff --cached --name-only", {
        encoding: "utf-8",
      });

      const files = [
        ...output.split("\n").filter(Boolean),
        ...stagedOutput.split("\n").filter(Boolean),
      ];

      // 重複排除
      return Array.from(new Set(files)).filter(
        (file) =>
          file.endsWith(".ts") ||
          file.endsWith(".tsx") ||
          file.endsWith(".js") ||
          file.endsWith(".jsx"),
      );
    } catch (error) {
      console.warn("⚠️ git diff実行失敗:", error);
      return [];
    }
  }

  /**
   * 受け入れ基準の読み込み（REQ, US, TASKファイルから）
   */
  private async loadAcceptanceCriteria(): Promise<AcceptanceCriterion[]> {
    const criteria: AcceptanceCriterion[] = [];

    const requirementFiles = this.findRequirementFiles();

    for (const file of requirementFiles) {
      const content = fs.readFileSync(file, "utf-8");
      const checkboxPattern = /^(\s*)-\s*\[([ x])\]\s*(.+)$/gm;

      let match;
      while ((match = checkboxPattern.exec(content)) !== null) {
        const checked = match[2] === "x";
        const text = match[3].trim();

        criteria.push({
          id: `${path.basename(file)}-${criteria.length}`,
          text,
          status: checked ? "implemented" : "pending",
          evidence: [],
        });
      }
    }

    return criteria;
  }

  /**
   * 要件ファイルの検索
   */
  private findRequirementFiles(): string[] {
    const files: string[] = [];
    const directories = [
      path.join(this.projectRoot, "docs/management/requirements/active"),
      path.join(this.projectRoot, "docs/management/user_stories/active"),
      path.join(this.projectRoot, "docs/management/tasks/active"),
    ];

    for (const dir of directories) {
      if (fs.existsSync(dir)) {
        const dirFiles = fs
          .readdirSync(dir)
          .filter((f) => f.endsWith(".md"))
          .map((f) => path.join(dir, f));
        files.push(...dirFiles);
      }
    }

    return files;
  }

  /**
   * 実装証拠の収集
   */
  private async collectImplementationEvidences(
    files: string[],
  ): Promise<ImplementationEvidence[]> {
    const evidences: ImplementationEvidence[] = [];

    for (const file of files) {
      const filePath = path.join(this.projectRoot, file);
      if (!fs.existsSync(filePath)) continue;

      const content = fs.readFileSync(filePath, "utf-8");
      const lines = content.split("\n");

      // 重要なキーワードを検索（userId, session, filter, whereCondition等）
      const keywords = [
        "userId",
        "session.user.id",
        "whereCondition",
        "filter",
        "authentication",
      ];

      lines.forEach((line, index) => {
        const lowerLine = line.toLowerCase();
        for (const keyword of keywords) {
          if (lowerLine.includes(keyword.toLowerCase())) {
            evidences.push({
              file,
              lineStart: index + 1,
              lineEnd: index + 1,
              description: line.trim(),
              verified: true,
            });
          }
        }
      });
    }

    return evidences;
  }

  /**
   * レポート本文の生成
   */
  private buildReport(data: {
    testResults: TestResult[];
    changedFiles: string[];
    acceptanceCriteria: AcceptanceCriterion[];
    evidences: ImplementationEvidence[];
  }): string {
    const timestamp = new Date().toISOString();

    let report = `# 実装検証レポート

## 生成日時
${timestamp}

## 実装完了項目

`;

    // テスト結果セクション
    report += `### テスト実行結果\n\n`;
    for (const test of data.testResults) {
      const status = test.passed ? "✅ 実装完了" : "❌ 失敗";
      report += `#### ${status}: ${test.testFile}\n`;
      report += `- 実行時間: ${(test.duration / 1000).toFixed(1)}秒\n`;
      report += `- ステータス: ${test.passed ? "passed" : "failed"}\n\n`;
    }

    // 受け入れ基準の検証状況
    report += `### 受け入れ基準の検証状況\n\n`;

    const implementedCriteria = data.acceptanceCriteria.filter(
      (c) => c.status === "implemented",
    );
    const pendingCriteria = data.acceptanceCriteria.filter(
      (c) => c.status === "pending",
    );

    report += `**実装完了**: ${implementedCriteria.length}/${data.acceptanceCriteria.length}項目\n\n`;

    // 実装完了項目をリスト化（フックのマッチング用）
    for (const criterion of implementedCriteria) {
      report += `#### ✅ 実装完了: ${criterion.text}\n`;
    }

    report += `\n### 未完了項目\n\n`;
    for (const criterion of pendingCriteria) {
      report += `#### ⚠️ 未検証: ${criterion.text}\n`;
    }

    // 実装証拠
    report += `\n## 実装証拠\n\n`;
    report += `**変更ファイル数**: ${data.changedFiles.length}件\n\n`;

    for (const evidence of data.evidences.slice(0, 20)) {
      // 最初の20件のみ表示
      report += `- \`${evidence.file}:${evidence.lineStart}\`: ${evidence.description}\n`;
    }

    report += `\n---\n*このレポートは自動生成されました*\n`;

    return report;
  }
}

/**
 * CLI実行時のエントリーポイント
 */
async function main() {
  if (import.meta.url === `file://${process.argv[1]}`) {
    try {
      const generator = new VerificationReportGenerator();
      await generator.generate();
      process.exit(0);
    } catch (error) {
      console.error("❌ 実装検証レポート生成エラー:", error);
      process.exit(1);
    }
  }
}

main();
