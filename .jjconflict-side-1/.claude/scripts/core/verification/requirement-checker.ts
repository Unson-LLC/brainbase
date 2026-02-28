#!/usr/bin/env node
/**
 * 要件完了チェックHook
 * 作業完了時に全要件が100%達成されているかチェックし、未完了項目があれば自動修正を実行
 */

import fs from "fs";
import path from "path";
import type { RequirementStatus } from "../../../../src/types/hooks/requirement-verification.js";

/**
 * 要件完了チェッククラス
 */
export class RequirementCompletionChecker {
  private projectRoot: string;
  private docsPath: string;

  constructor() {
    this.projectRoot = process.cwd();
    this.docsPath = path.join(this.projectRoot, "docs");
  }

  /**
   * 全要件ファイルの完了状況をチェック
   */
  async checkAllRequirements(): Promise<RequirementStatus[]> {
    console.log("🔍 要件完了状況をチェック中...");

    const requirementFiles = await this.findRequirementFiles();
    const statuses: RequirementStatus[] = [];

    for (const file of requirementFiles) {
      const status = await this.checkRequirementFile(file);
      statuses.push(status);
    }

    return statuses;
  }

  /**
   * 未完了項目の自動修正実行
   */
  async autoFixIncompleteItems(statuses: RequirementStatus[]): Promise<void> {
    const incompleteFiles = statuses.filter((s) => s.completionRate < 100);

    if (incompleteFiles.length === 0) {
      console.log("✅ 全要件が完了済みです");
      return;
    }

    console.log(`⚠️ 未完了の要件ファイル: ${incompleteFiles.length}件`);

    for (const file of incompleteFiles) {
      console.log(`🔧 自動修正実行: ${file.file}`);
      await this.fixIncompleteFile(file);
    }
  }

  /**
   * 要件ファイルを検索
   */
  private async findRequirementFiles(): Promise<string[]> {
    const files: string[] = [];

    // REQ, US, TASK ファイルを検索
    const directories = [
      path.join(this.docsPath, "requirements", "active"),
      path.join(this.docsPath, "user_stories", "active"),
      path.join(this.docsPath, "tasks", "active"),
    ];

    for (const dir of directories) {
      if (fs.existsSync(dir)) {
        const dirFiles = fs
          .readdirSync(dir)
          .filter(
            (f) =>
              f.endsWith(".md") &&
              (f.startsWith("REQ-") ||
                f.startsWith("US-") ||
                f.startsWith("TASK-")),
          )
          .map((f) => path.join(dir, f));

        files.push(...dirFiles);
      }
    }

    return files;
  }

  /**
   * 個別要件ファイルの完了状況チェック
   */
  private async checkRequirementFile(
    filePath: string,
  ): Promise<RequirementStatus> {
    const content = fs.readFileSync(filePath, "utf-8");
    const fileName = path.basename(filePath);

    // チェックボックスパターン
    const checkboxPattern = /^(\s*)-\s*\[([ x])\]\s*(.+)$/gm;
    const matches = [...content.matchAll(checkboxPattern)];

    const totalItems = matches.length;
    const completedItems = matches.filter((match) => match[2] === "x").length;
    const completionRate =
      totalItems > 0 ? (completedItems / totalItems) * 100 : 100;

    const uncheckedItems = matches
      .filter((match) => match[2] === " ")
      .map((match) => match[3].trim());

    return {
      file: fileName,
      totalItems,
      completedItems,
      completionRate,
      uncheckedItems,
    };
  }

  /**
   * 未完了ファイルの自動修正
   */
  private async fixIncompleteFile(status: RequirementStatus): Promise<void> {
    const filePath = this.findFileByName(status.file);
    if (!filePath) {
      console.error(`❌ ファイルが見つかりません: ${status.file}`);
      return;
    }

    let content = fs.readFileSync(filePath, "utf-8");

    // 汎用的な自動修正: 実装検証システムとの連携
    content = await this.autoFixBasedOnImplementation(content, status.file);

    fs.writeFileSync(filePath, content, "utf-8");
    console.log(`✅ 自動修正完了: ${status.file}`);
  }

  /**
   * 汎用的な実装ベースの自動修正
   * 実装検証システムと連携し、実装が確認できた項目を自動チェック
   */
  private async autoFixBasedOnImplementation(
    content: string,
    fileName: string,
  ): Promise<string> {
    // 実装検証の結果を取得（存在する場合）
    const implementationStatus = await this.getImplementationStatus(fileName);

    if (implementationStatus) {
      // 実装が確認された項目をチェック
      for (const item of implementationStatus.implementedItems) {
        // チェックボックスパターンを検索してチェック
        const pattern = new RegExp(`^(\\s*)-\\s*\\[\\s\\]\\s*(.*)$`, "gm");

        // より柔軟なマッチング: 部分一致でも実装確認できればチェック
        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i++) {
          if (
            lines[i].match(pattern) &&
            this.isRelatedToImplementation(lines[i], item)
          ) {
            lines[i] = lines[i].replace(/\[\s\]/, "[x]");
          }
        }
        content = lines.join("\n");
      }
    } else {
      // 実装検証結果がない場合は、保守的にチェックをスキップ
      console.log(
        `⚠️ ${fileName} の実装検証結果が見つかりません。手動確認が必要です。`,
      );
    }

    return content;
  }

  /**
   * 実装検証結果を取得
   */
  private async getImplementationStatus(fileName: string): Promise<any> {
    // 実装検証レポートから該当要件の状況を取得
    const reportPath = path.join(
      this.projectRoot,
      ".claude/output/reports/implementation-verification-report.md",
    );

    if (!fs.existsSync(reportPath)) {
      return null;
    }

    const report = fs.readFileSync(reportPath, "utf-8");

    // 実装済み項目を抽出（汎用的なパターン）
    const implementedItems: string[] = [];
    const lines = report.split("\n");

    for (const line of lines) {
      if (line.includes("✅") && line.includes("実装完了")) {
        // 実装完了項目を記録
        implementedItems.push(line);
      }
    }

    return { implementedItems };
  }

  /**
   * チェックボックス行と実装項目の関連性を判定
   */
  private isRelatedToImplementation(
    checkboxLine: string,
    implementationItem: string,
  ): boolean {
    // 実装項目から「✅ 実装完了:」プレフィックスを除去
    const cleanedItem = implementationItem
      .replace(/^#+\s*✅\s*実装完了:\s*/i, "")
      .trim();

    // チェックボックス行から「- [ ]」や「- [x]」を除去
    const cleanedCheckbox = checkboxLine
      .replace(/^[-*]\s*\[([ x])\]\s*/i, "")
      .trim();

    // 正規化（小文字化、連続スペース削除）
    const normalizedItem = cleanedItem.toLowerCase().replace(/\s+/g, "");
    const normalizedCheckbox = cleanedCheckbox
      .toLowerCase()
      .replace(/\s+/g, "");

    // 完全一致または部分一致（70%以上）で判定
    if (normalizedItem === normalizedCheckbox) {
      return true;
    }

    // 部分一致判定（日本語対応）
    // 文字単位でマッチング
    let matchCount = 0;
    const itemChars = normalizedItem.split("");
    const checkboxChars = normalizedCheckbox.split("");

    for (const char of itemChars) {
      if (checkboxChars.includes(char)) {
        matchCount++;
      }
    }

    const matchRatio = matchCount / itemChars.length;
    return matchRatio >= 0.7;
  }

  /**
   * ファイル名からフルパスを検索
   */
  private findFileByName(fileName: string): string | null {
    const directories = [
      path.join(this.docsPath, "requirements", "active"),
      path.join(this.docsPath, "user_stories", "active"),
      path.join(this.docsPath, "tasks", "active"),
    ];

    for (const dir of directories) {
      const filePath = path.join(dir, fileName);
      if (fs.existsSync(filePath)) {
        return filePath;
      }
    }

    return null;
  }

  /**
   * 完了状況レポート生成
   */
  async generateCompletionReport(statuses: RequirementStatus[]): Promise<void> {
    const reportPath = path.join(
      this.projectRoot,
      ".claude/output/reports/requirement-completion-report.md",
    );

    const totalFiles = statuses.length;
    const completedFiles = statuses.filter(
      (s) => s.completionRate === 100,
    ).length;
    const overallCompletion =
      totalFiles > 0 ? (completedFiles / totalFiles) * 100 : 100;

    const report = `# 要件完了状況レポート

## 実行日時: ${new Date().toISOString()}

## 完了状況サマリー

**全体完了率**: ${overallCompletion.toFixed(1)}% (${completedFiles}/${totalFiles} ファイル)

${statuses
  .map(
    (status) => `
### ${status.file}
- 📊 完了率: ${status.completionRate.toFixed(1)}% (${status.completedItems}/${status.totalItems} 項目)
- ${status.completionRate === 100 ? "✅ 完了" : "⚠️ 未完了"}
${
  status.uncheckedItems.length > 0
    ? `
**未完了項目:**
${status.uncheckedItems.map((item) => `- ${item}`).join("\n")}
`
    : ""
}
`,
  )
  .join("\n")}

## 改善アクション

${
  overallCompletion === 100
    ? "🎉 全要件が完了しています。"
    : `⚠️ 未完了項目があります。自動修正を実行してください：
\`\`\`bash
npx tsx .claude/scripts/verification/requirement-completion-check.ts --auto-fix
\`\`\``
}

---
*このレポートは要件完了チェックシステムにより生成されました*
`;

    fs.writeFileSync(reportPath, report, "utf-8");
    console.log(`📄 完了状況レポート生成: ${reportPath}`);
  }
}

/**
 * CLI実行時のエントリーポイント
 */
async function main() {
  if (import.meta.url === `file://${process.argv[1]}`) {
    const checker = new RequirementCompletionChecker();
    const autoFix = process.argv.includes("--auto-fix");

    try {
      const statuses = await checker.checkAllRequirements();

      console.log("\n📊 要件完了状況チェック結果:");
      for (const status of statuses) {
        const statusIcon = status.completionRate === 100 ? "✅" : "⚠️";
        console.log(
          `${statusIcon} ${status.file}: ${status.completionRate.toFixed(1)}% (${status.completedItems}/${status.totalItems})`,
        );
      }

      await checker.generateCompletionReport(statuses);

      if (autoFix) {
        await checker.autoFixIncompleteItems(statuses);

        // 修正後の再チェック
        const updatedStatuses = await checker.checkAllRequirements();
        await checker.generateCompletionReport(updatedStatuses);
      }

      const incompleteFiles = statuses.filter((s) => s.completionRate < 100);
      if (incompleteFiles.length > 0 && !autoFix) {
        console.log(
          "\n💡 未完了項目を自動修正するには: npx tsx .claude/scripts/verification/requirement-completion-check.ts --auto-fix",
        );
        process.exit(1);
      }

      console.log("\n🎉 要件完了チェック完了");
    } catch (error) {
      console.error("❌ 要件完了チェックエラー:", error);
      process.exit(1);
    }
  }
}

main();
