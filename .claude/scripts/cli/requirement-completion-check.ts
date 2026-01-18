#!/usr/bin/env npx tsx
/**
 * 受け入れ基準自動チェックシステム
 *
 * 実装検証レポートの内容と設計書（REQ/US/TASK）の受け入れ基準を照合し、
 * チェックボックスを自動的に更新します。
 */

import * as fs from "fs";
import * as path from "path";

// 定数
const REPORT_PATH =
  ".claude/output/reports/implementation-verification-report.md";
const DOCS_DIR = "docs";

interface CheckboxMatch {
  file: string;
  lineNumber: number;
  originalLine: string;
  completedText: string;
  matchScore: number;
}

/**
 * 実装検証レポートから完了項目を抽出
 */
function extractCompletedItems(reportPath: string): string[] {
  if (!fs.existsSync(reportPath)) {
    console.error(`❌ 実装検証レポートが見つかりません: ${reportPath}`);
    return [];
  }

  const content = fs.readFileSync(reportPath, "utf-8");
  const completedItems: string[] = [];

  // "#### ✅ 実装完了: " 形式の行を抽出
  const regex = /#### ✅ 実装完了: (.+)/g;
  let match;

  while ((match = regex.exec(content)) !== null) {
    completedItems.push(match[1].trim());
  }

  console.log(
    `📊 実装検証レポートから ${completedItems.length} 項目の完了を検出`,
  );
  return completedItems;
}

/**
 * 設計書ファイルを取得
 */
function getDesignDocuments(): string[] {
  const docs: string[] = [];

  // REQ files
  const reqDir = path.join(DOCS_DIR, "requirements", "active");
  if (fs.existsSync(reqDir)) {
    const reqFiles = fs
      .readdirSync(reqDir)
      .filter((f) => f.startsWith("REQ-") && f.endsWith(".md"));
    docs.push(...reqFiles.map((f) => path.join(reqDir, f)));
  }

  // US files
  const usDir = path.join(DOCS_DIR, "user_stories", "active");
  if (fs.existsSync(usDir)) {
    const usFiles = fs
      .readdirSync(usDir)
      .filter((f) => f.startsWith("US-") && f.endsWith(".md"));
    docs.push(...usFiles.map((f) => path.join(usDir, f)));
  }

  // TASK files
  const taskDir = path.join(DOCS_DIR, "tasks", "active");
  if (fs.existsSync(taskDir)) {
    const taskFiles = fs
      .readdirSync(taskDir)
      .filter((f) => f.startsWith("TASK-") && f.endsWith(".md"));
    docs.push(...taskFiles.map((f) => path.join(taskDir, f)));
  }

  console.log(`📂 ${docs.length} 件の設計書を検出`);
  return docs;
}

/**
 * チェックボックステキストの類似度を計算（単純なキーワードマッチング）
 */
function calculateSimilarity(text1: string, text2: string): number {
  const normalize = (str: string) =>
    str
      .toLowerCase()
      .replace(/[「」『』【】\[\]]/g, "") // 括弧除去
      .replace(/\s+/g, " ")
      .trim();

  const t1 = normalize(text1);
  const t2 = normalize(text2);

  // 完全一致
  if (t1 === t2) return 1.0;

  // キーワードマッチング
  const words1 = t1.split(/\s+/);
  const words2 = t2.split(/\s+/);

  let matchCount = 0;
  for (const word of words1) {
    if (words2.some((w) => w.includes(word) || word.includes(w))) {
      matchCount++;
    }
  }

  return matchCount / Math.max(words1.length, words2.length);
}

/**
 * 設計書内の未チェック項目と実装完了項目をマッチング
 */
function findMatchingCheckboxes(
  docPath: string,
  completedItems: string[],
): CheckboxMatch[] {
  const content = fs.readFileSync(docPath, "utf-8");
  const lines = content.split("\n");
  const matches: CheckboxMatch[] = [];

  lines.forEach((line, index) => {
    // 未チェックのチェックボックス
    const uncheckedMatch = line.match(/^(\s*)- \[ \] (.+)$/);
    if (uncheckedMatch) {
      const checkboxText = uncheckedMatch[2].trim();

      // 実装完了項目との類似度を計算
      for (const completedItem of completedItems) {
        const similarity = calculateSimilarity(checkboxText, completedItem);

        // 50%以上の類似度でマッチング
        if (similarity >= 0.5) {
          matches.push({
            file: docPath,
            lineNumber: index + 1,
            originalLine: line,
            completedText: completedItem,
            matchScore: similarity,
          });
          break; // 最初のマッチで停止
        }
      }
    }
  });

  return matches;
}

/**
 * チェックボックスを更新
 */
function updateCheckboxes(matches: CheckboxMatch[]): number {
  const fileUpdates: Map<string, { lines: string[]; changes: number }> =
    new Map();

  // ファイルごとにグループ化
  for (const match of matches) {
    if (!fileUpdates.has(match.file)) {
      const content = fs.readFileSync(match.file, "utf-8");
      fileUpdates.set(match.file, { lines: content.split("\n"), changes: 0 });
    }

    const fileData = fileUpdates.get(match.file)!;
    const lineIndex = match.lineNumber - 1;

    // "- [ ]" → "- [x]" に変換
    const updatedLine = fileData.lines[lineIndex].replace("- [ ]", "- [x]");
    if (updatedLine !== fileData.lines[lineIndex]) {
      fileData.lines[lineIndex] = updatedLine;
      fileData.changes++;
      console.log(
        `  ✅ L${match.lineNumber}: ${match.completedText.substring(0, 60)}...`,
      );
    }
  }

  // ファイルに書き戻し
  let totalChanges = 0;
  for (const [filePath, fileData] of fileUpdates.entries()) {
    if (fileData.changes > 0) {
      fs.writeFileSync(filePath, fileData.lines.join("\n"));
      console.log(
        `\n📝 ${path.basename(filePath)}: ${fileData.changes} 項目を更新`,
      );
      totalChanges += fileData.changes;
    }
  }

  return totalChanges;
}

/**
 * メイン処理
 */
function main() {
  console.log("🔍 受け入れ基準自動チェックを開始...\n");

  // 1. 実装検証レポートから完了項目を取得
  const completedItems = extractCompletedItems(REPORT_PATH);
  if (completedItems.length === 0) {
    console.log(
      "⚠️  完了項目が見つかりません。先に実装検証レポートを生成してください。",
    );
    console.log("   実行: npm run verify:report\n");
    process.exit(1);
  }

  // 2. 設計書ファイルを取得
  const documents = getDesignDocuments();
  if (documents.length === 0) {
    console.log("⚠️  設計書が見つかりません。");
    process.exit(1);
  }

  // 3. 各設計書でマッチングを実行
  const allMatches: CheckboxMatch[] = [];
  for (const docPath of documents) {
    const matches = findMatchingCheckboxes(docPath, completedItems);
    if (matches.length > 0) {
      console.log(
        `\n📄 ${path.basename(docPath)}: ${matches.length} 項目がマッチング`,
      );
      allMatches.push(...matches);
    }
  }

  if (allMatches.length === 0) {
    console.log("\n✅ 更新対象のチェックボックスはありません。");
    process.exit(0);
  }

  // 4. チェックボックスを更新
  console.log(`\n📝 ${allMatches.length} 項目のチェックボックスを更新中...\n`);
  const totalChanges = updateCheckboxes(allMatches);

  console.log(
    `\n✅ 受け入れ基準チェック完了: ${totalChanges} 項目を更新しました。\n`,
  );
}

// ESM環境での実行チェック
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
