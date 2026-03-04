#!/usr/bin/env npx tsx
/**
 * 編集後品質検証フック
 *
 * @description Write/Edit/MultiEdit実行後に品質検証と完全性チェックを行い、
 *              未完了項目や改善提案を自動検出するフック
 * @author SalesTailor Development Team
 * @version 1.0.0
 */

import * as fs from "fs";
import * as path from "path";
import type { PostEditValidationResult } from "../../../../src/types/hooks/edit-validation.js";
import { runTypeCheck } from "./type-checker.js";

/**
 * 編集後品質検証実行
 */
async function validatePostEditQuality(): Promise<PostEditValidationResult> {
  const result: PostEditValidationResult = {
    completenessScore: 100,
    criticalIssues: [],
    improvements: [],
    nextActions: [],
    qualityReminders: [],
  };

  // 基本品質リマインダー（常に表示）
  result.qualityReminders = [
    "🎯 **作業完了前の必須確認事項**:",
    "   □ ファイル全体を再読み込みして漏れがないか確認済み？",
    "   □ 関連ファイルへの影響を確認済み？",
    "   □ 他に同様の修正が必要な箇所はないか確認済み？",
    "   □ ベストプラクティスに沿った実装になっているか？",
    "",
    "🚨 **ユーザー指摘を避けるための自己チェック**:",
    "   □ 「なぜこちらから指摘しないといけないのか」を防げたか？",
    "   □ プロアクティブな改善提案を行ったか？",
    "   □ 一歩先を読んだ対応をしたか？",
    "",
  ];

  // 最近編集されたファイルの検証
  const editedFiles = await getRecentlyEditedFiles();

  for (const file of editedFiles) {
    await validateEditedFile(file, result);
  }

  // 完全性スコア計算
  result.completenessScore = calculateCompletenessScore(result);

  // 次のアクションを提案
  generateNextActions(result);

  return result;
}

/**
 * 最近編集されたファイルを取得
 */
async function getRecentlyEditedFiles(): Promise<string[]> {
  try {
    const { execSync } = require("child_process");

    // Git statusでステージされた・変更されたファイルを取得
    const gitStatus = execSync("git status --porcelain", {
      encoding: "utf8",
    }).trim();
    const files: string[] = [];

    gitStatus.split("\n").forEach((line: string) => {
      if (line.trim()) {
        const status = line.substring(0, 2);
        const file = line.substring(3).trim();

        // 修正・追加・削除されたファイルを対象
        if (
          ["M ", " M", "A ", " A", "MM", "AM"].includes(status) &&
          fs.existsSync(file)
        ) {
          files.push(file);
        }
      }
    });

    return files;
  } catch (error) {
    return [];
  }
}

/**
 * 編集されたファイルの検証
 */
async function validateEditedFile(
  filePath: string,
  result: PostEditValidationResult,
): Promise<void> {
  try {
    const content = fs.readFileSync(filePath, "utf-8");

    // TypeScriptファイルの場合の詳細検証
    if (filePath.endsWith(".ts") || filePath.endsWith(".tsx")) {
      await validateTypeScriptFile(filePath, content, result);
    }

    // 型定義ファイルの検証
    if (filePath.includes("/types/")) {
      await validateTypeDefinitionFile(filePath, content, result);
    }

    // Hook関連ファイルの検証
    if (filePath.includes(".claude/") || filePath.includes("hooks/")) {
      await validateHookFile(filePath, content, result);
    }
  } catch (error) {
    result.criticalIssues.push(
      `❌ ファイル読み込みエラー: ${path.basename(filePath)}`,
    );
  }
}

/**
 * TypeScriptファイルの検証
 */
async function validateTypeScriptFile(
  filePath: string,
  content: string,
  result: PostEditValidationResult,
): Promise<void> {
  const lines = content.split("\n");
  let issues = 0;

  // 1. JSDoc完全性チェック
  const methods = extractMethods(lines);
  const classes = extractClasses(lines);

  for (const method of methods) {
    if (!hasJSDoc(lines, method.lineNumber)) {
      result.criticalIssues.push(
        `📝 JSDoc不足: ${path.basename(filePath)}:${method.lineNumber} - ${method.name}`,
      );
      issues++;
    }
  }

  for (const cls of classes) {
    if (!hasJSDoc(lines, cls.lineNumber)) {
      result.criticalIssues.push(
        `📝 クラスJSDoc不足: ${path.basename(filePath)}:${cls.lineNumber} - ${cls.name}`,
      );
      issues++;
    }
  }

  // 2. 型定義の配置チェック
  if (hasInlineTypeDefinitions(content) && !filePath.includes("src/types/")) {
    result.improvements.push(
      `🏗️ 型定義移動推奨: ${path.basename(filePath)} - 型定義をsrc/types/に移動検討`,
    );
    issues++;
  }

  // 3. 共通化機会チェック
  const commonizationOpportunities = detectCommonizationOpportunities(content);
  if (commonizationOpportunities.length > 0) {
    result.improvements.push(
      `🔄 共通化機会: ${path.basename(filePath)} - ${commonizationOpportunities.join(", ")}`,
    );
  }

  // 4. 英語テキストチェック
  const englishTexts = detectEnglishTexts(content);
  if (englishTexts.length > 0) {
    result.improvements.push(
      `🌏 日本語化推奨: ${path.basename(filePath)} - ${englishTexts.length}箇所の英語テキスト`,
    );
  }

  // スコア調整
  if (issues > 0) {
    result.completenessScore -= Math.min(issues * 10, 50);
  }
}

/**
 * 型定義ファイルの検証
 */
async function validateTypeDefinitionFile(
  filePath: string,
  content: string,
  result: PostEditValidationResult,
): Promise<void> {
  // 型定義ファイル特有の検証
  const interfaces = content.match(/interface\s+\w+/g) || [];
  const types = content.match(/type\s+\w+/g) || [];

  let documentedCount = 0;
  const totalDefinitions = interfaces.length + types.length;

  // JSDoc付きの定義をカウント
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].match(/^\s*(export\s+)?(interface|type)\s+\w+/)) {
      if (hasJSDoc(lines, i + 1)) {
        documentedCount++;
      } else {
        result.criticalIssues.push(
          `📝 型定義JSDoc不足: ${path.basename(filePath)}:${i + 1}`,
        );
      }
    }
  }

  if (totalDefinitions > 0) {
    const documentationRate = (documentedCount / totalDefinitions) * 100;
    if (documentationRate < 100) {
      result.completenessScore -= (100 - documentationRate) / 2;
    }
  }
}

/**
 * Hookファイルの検証
 */
async function validateHookFile(
  filePath: string,
  content: string,
  result: PostEditValidationResult,
): Promise<void> {
  // Hook特有の検証項目

  // 1. 日本語化チェック（Hookは特に重要）
  const englishTexts = detectEnglishTexts(content);
  if (englishTexts.length > 0) {
    result.criticalIssues.push(
      `🌏 Hook日本語化必須: ${path.basename(filePath)} - ${englishTexts.length}箇所の英語テキスト`,
    );
    result.completenessScore -= 20;
  }

  // 2. Hook共通ユーティリティ使用チェック
  if (
    content.includes("fs.appendFileSync") &&
    !content.includes("logHookMessage")
  ) {
    result.improvements.push(
      `🔧 Hook共通化: ${path.basename(filePath)} - logHookMessage使用推奨`,
    );
  }

  // 3. エラーハンドリングチェック
  if (content.includes("execSync") && !content.includes("try")) {
    result.improvements.push(
      `🛡️ エラーハンドリング: ${path.basename(filePath)} - try-catch追加推奨`,
    );
  }

  // 4. Fail-Safe原則違反検出
  validateErrorHandling(filePath, content, result);
}

/**
 * エラーハンドリングの検証（Fail-Safe原則）
 */
function validateErrorHandling(
  filePath: string,
  content: string,
  result: PostEditValidationResult,
): void {
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // catch (error) { console.error(...) } パターン（エラー握りつぶし）
    if (line.includes("} catch") || line.includes("}catch")) {
      let catchBlockEnd = i;
      let braceCount = 0;
      let foundError = false;

      // catchブロックの終わりを探す
      for (let j = i; j < lines.length && j < i + 20; j++) {
        const catchLine = lines[j];
        braceCount += (catchLine.match(/{/g) || []).length;
        braceCount -= (catchLine.match(/}/g) || []).length;

        if (catchLine.includes("console.error")) foundError = true;

        if (braceCount === 0 && j > i) {
          catchBlockEnd = j;
          break;
        }
      }

      const catchBlock = lines.slice(i, catchBlockEnd + 1).join("\n");

      // エラーログのみで何もしないパターン
      if (
        foundError &&
        !catchBlock.includes("return") &&
        !catchBlock.includes("throw") &&
        !catchBlock.includes("process.exit") &&
        !catchBlock.includes("blocked") &&
        !catchBlock.includes("permissionDecision")
      ) {
        result.criticalIssues.push(
          `🚨 Fail-Safe違反: ${path.basename(filePath)}:${i + 1} - catchでエラーを握りつぶしています（ログのみで処理継続）`,
        );
        result.completenessScore -= 15;
      }

      // パース失敗時にallowで通過させるパターン
      if (
        catchBlock.includes('permissionDecision: "allow"') ||
        catchBlock.includes("permissionDecision: 'allow'")
      ) {
        result.criticalIssues.push(
          `🚨 Fail-Safe違反: ${path.basename(filePath)}:${i + 1} - エラー時にallowで通過させています`,
        );
        result.completenessScore -= 20;
      }
    }
  }
}

/**
 * メソッド抽出
 */
function extractMethods(
  lines: string[],
): Array<{ name: string; lineNumber: number }> {
  const methods: Array<{ name: string; lineNumber: number }> = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // メソッド・関数定義パターンの検出
    const methodMatch =
      line.match(
        /^\s*(private|public|protected)?\s*(async\s+)?(\w+)\s*\([^)]*\)\s*:?\s*[^{]*\s*{/,
      ) ||
      line.match(/^(export\s+)?(async\s+)?function\s+(\w+)/) ||
      line.match(/^\s*(\w+)\s*=\s*(async\s+)?\([^)]*\)\s*=>/);

    if (methodMatch) {
      const name = methodMatch[3] || methodMatch[1] || "unknown";
      methods.push({ name, lineNumber: i + 1 });
    }
  }

  return methods;
}

/**
 * クラス抽出
 */
function extractClasses(
  lines: string[],
): Array<{ name: string; lineNumber: number }> {
  const classes: Array<{ name: string; lineNumber: number }> = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const classMatch = line.match(/^(export\s+)?class\s+(\w+)/);

    if (classMatch) {
      classes.push({ name: classMatch[2], lineNumber: i + 1 });
    }
  }

  return classes;
}

/**
 * JSDoc存在確認
 */
function hasJSDoc(lines: string[], lineNumber: number): boolean {
  const startIndex = Math.max(0, lineNumber - 15);
  const endIndex = lineNumber - 1;

  const precedingLines = lines.slice(startIndex, endIndex).join("\n");
  return precedingLines.includes("/**") && precedingLines.includes("*/");
}

/**
 * インライン型定義検出
 */
function hasInlineTypeDefinitions(content: string): boolean {
  return /^\s*(interface|type|enum)\s+\w+/m.test(content);
}

/**
 * 共通化機会検出
 */
function detectCommonizationOpportunities(content: string): string[] {
  const opportunities: string[] = [];

  if (content.includes("private log(") || content.includes("function log(")) {
    opportunities.push("ログ関数共通化");
  }

  if (
    content.includes("generateTimestamp") ||
    content.includes("new Date().toISOString()")
  ) {
    opportunities.push("タイムスタンプ生成共通化");
  }

  if (content.includes("fs.mkdirSync") && content.includes("recursive")) {
    opportunities.push("ディレクトリ作成共通化");
  }

  if (content.match(/fs\.(writeFileSync|appendFileSync).*\.log/)) {
    opportunities.push("ログ出力共通化");
  }

  return opportunities;
}

/**
 * 英語テキスト検出
 */
function detectEnglishTexts(content: string): string[] {
  const patterns = [
    /"[^"]*[A-Za-z]{4,}[^"]*"/g,
    /'[^']*[A-Za-z]{4,}[^']*'/g,
    /`[^`]*[A-Za-z]{4,}[^`]*`/g,
  ];

  const technicalTerms = [
    "import",
    "export",
    "function",
    "class",
    "interface",
    "type",
    "enum",
    "console",
    "process",
    "require",
    "module",
    "async",
    "await",
    "Promise",
    "Array",
    "Object",
    "String",
    "Number",
    "Boolean",
    "git",
    "npm",
    "node",
    "typescript",
    "javascript",
    "json",
    "http",
    "https",
    "api",
    "url",
    "path",
    "file",
    "directory",
  ];

  const englishTexts: string[] = [];

  for (const pattern of patterns) {
    const matches = content.match(pattern) || [];
    for (const match of matches) {
      const isTechnical = technicalTerms.some((term) =>
        match.toLowerCase().includes(term.toLowerCase()),
      );

      if (!isTechnical && match.length > 8) {
        englishTexts.push(match);
      }
    }
  }

  return [...new Set(englishTexts)];
}

/**
 * 完全性スコア計算
 */
function calculateCompletenessScore(result: PostEditValidationResult): number {
  let score = 100;

  // クリティカル問題は大幅減点
  score -= result.criticalIssues.length * 15;

  // 改善項目は軽微減点
  score -= result.improvements.length * 5;

  return Math.max(0, score);
}

/**
 * 次のアクション生成
 */
function generateNextActions(result: PostEditValidationResult): void {
  if (result.criticalIssues.length > 0) {
    result.nextActions.push("🚨 クリティカル問題の即座修正が必要");
  }

  if (result.improvements.length > 0) {
    result.nextActions.push("💡 改善提案の検討・実装を推奨");
  }

  if (result.completenessScore < 90) {
    result.nextActions.push("📋 品質基準達成のため追加作業が必要");
  }

  result.nextActions.push("🔍 関連ファイルへの同様修正の確認");
  result.nextActions.push("⚡ ベストプラクティス適用の確認");

  if (result.completenessScore >= 95) {
    result.nextActions.push("✅ 高品質な作業完了 - ユーザー満足度向上");
  }
}

/**
 * メイン実行
 */
async function main(): Promise<any> {
  try {
    // 1. 型チェック実行（最優先）
    const typeCheckResult = await runTypeCheck();

    if (typeCheckResult.hasErrors) {
      const hookResponse = {
        continue: true, // 通知のみ（処理は継続）
        systemMessage: `⚠️ TypeScript型エラーが検出されました（${typeCheckResult.errors.length}件）\n\n【検出されたエラー】\n${typeCheckResult.errors.slice(0, 5).join("\n")}\n${typeCheckResult.errors.length > 5 ? `\n...他${typeCheckResult.errors.length - 5}件のエラー` : ""}\n\n【推奨対処】\n• npm run typecheckで全エラー確認\n• 型定義の修正\n• import文のパス確認`,
        suppressOutput: false,
      };

      console.log(JSON.stringify(hookResponse));
      return hookResponse;
    }

    // 2. 品質検証実行
    const validationResult = await validatePostEditQuality();

    // Claude Code Hook公式仕様に従った出力（通知のみ、処理は継続）
    if (
      validationResult.criticalIssues.length > 0 ||
      validationResult.completenessScore < 80
    ) {
      const hookResponse = {
        continue: true, // 通知のみ（処理は継続）
        systemMessage: `⚠️ 品質スコア: ${validationResult.completenessScore}/100\n\n【クリティカル問題】\n${validationResult.criticalIssues.map((issue) => `• ${issue}`).join("\n")}\n\n【改善提案】\n${validationResult.improvements.map((improvement) => `• ${improvement}`).join("\n")}\n\n【推奨アクション】\n${validationResult.nextActions.map((action) => `• ${action}`).join("\n")}`,
        suppressOutput: false,
      };

      console.log(JSON.stringify(hookResponse));
      return hookResponse;
    } else if (validationResult.improvements.length > 0) {
      const hookResponse = {
        continue: true, // 通知のみ（処理は継続）
        systemMessage: `💡 品質改善提案があります\n\n【改善提案】\n${validationResult.improvements.map((improvement) => `• ${improvement}`).join("\n")}\n\n【推奨アクション】\n${validationResult.nextActions.map((action) => `• ${action}`).join("\n")}`,
        suppressOutput: false,
      };

      console.log(JSON.stringify(hookResponse));
      return hookResponse;
    } else {
      const hookResponse = {
        continue: true,
        systemMessage: `✅ 品質検証完了 (スコア: ${validationResult.completenessScore}/100) - 問題なし`,
        suppressOutput: false,
      };

      console.log(JSON.stringify(hookResponse));
      return hookResponse;
    }
  } catch (error) {
    console.error("⚠️ 品質検証実行エラー:", error);

    const errorResponse = {
      continue: true, // エラー時も処理は継続（Fail-Safe原則）
      systemMessage: `⚠️ 品質検証システムエラー（処理は継続）\n\nエラー詳細: ${String(error)}\n\n推奨対処:\n• フックスクリプトの構文確認\n• 必要な依存関係の確認\n• ファイルアクセス権限の確認`,
      suppressOutput: false,
    };

    console.log(JSON.stringify(errorResponse));
    return errorResponse;
  }
}

// 実行
import { fileURLToPath } from "url";
const __filename = fileURLToPath(import.meta.url);
const isMainModule = process.argv[1] === __filename;

if (isMainModule) {
  main();
}

export { main as default };

export { validatePostEditQuality };
