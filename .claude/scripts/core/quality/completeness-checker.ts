#!/usr/bin/env npx tsx
/**
 * 品質完全性チェッカー
 *
 * @description Write/Edit/MultiEdit実行前に品質完全性をチェックし、
 *              プロアクティブな改善提案を行うフック
 * @author SalesTailor Development Team
 * @version 1.0.0
 */

import * as fs from "fs";
import * as path from "path";

import type { QualityCheckResult } from "../../../../src/types/claude-hooks.js";

/**
 * 品質完全性チェック実行
 */
async function checkQualityCompleteness(): Promise<QualityCheckResult> {
  const result: QualityCheckResult = {
    hasIssues: false,
    issues: [],
    suggestions: [],
    reminders: [],
  };

  // 必須リマインダー（常に表示）
  result.reminders = [
    "🎯 **完全性チェックリスト**:",
    "   □ 全メソッドにJSDoc追加済み？",
    "   □ 型定義は適切な場所に配置済み？",
    "   □ 共通化可能なコードはないか？",
    "   □ 英語テキストの日本語化完了？",
    "   □ 関連ファイルへの影響確認済み？",
    "",
    "⚡ **プロアクティブ思考**:",
    "   □ ユーザー指摘待ちではなく先回り改善",
    "   □ ベストプラクティスに沿った提案",
    "   □ 一歩先を読む改善の実施",
    "",
  ];

  // 最近変更されたTypeScriptファイルをチェック
  const recentFiles = await getRecentlyModifiedFiles();

  for (const file of recentFiles) {
    if (file.endsWith(".ts") || file.endsWith(".tsx")) {
      await checkTypeScriptFile(file, result);
    }
  }

  // src/types/ 配下の整理状況チェック
  await checkTypeOrganization(result);

  // 共通化可能性チェック
  await checkCommonizationOpportunities(result);

  return result;
}

/**
 * 最近変更されたファイルを取得
 */
async function getRecentlyModifiedFiles(): Promise<string[]> {
  try {
    const { execSync } = require("child_process");

    // 最近変更されたファイルを取得（git status + 最近のコミット）
    const gitStatus = execSync("git status --porcelain", {
      encoding: "utf8",
    }).trim();
    const gitLog = execSync("git log --name-only --pretty=format: -5", {
      encoding: "utf8",
    }).trim();

    const files = new Set<string>();

    // git statusからファイル取得
    gitStatus.split("\n").forEach((line: string) => {
      if (line.trim()) {
        const file = line.substring(3).trim();
        if (fs.existsSync(file)) {
          files.add(file);
        }
      }
    });

    // git logからファイル取得
    gitLog.split("\n").forEach((line: string) => {
      if (line.trim() && fs.existsSync(line.trim())) {
        files.add(line.trim());
      }
    });

    return Array.from(files);
  } catch (error) {
    return [];
  }
}

/**
 * TypeScriptファイルの品質チェック
 */
async function checkTypeScriptFile(
  filePath: string,
  result: QualityCheckResult,
): Promise<void> {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const lines = content.split("\n");

    // JSDocチェック
    await checkJSDocCompleteness(filePath, content, lines, result);

    // 型定義チェック
    await checkTypeDefinitions(filePath, content, result);

    // 共通化チェック
    await checkCommonizationInFile(filePath, content, result);

    // 英語テキストチェック
    await checkEnglishText(filePath, content, result);
  } catch (error) {
    // ファイル読み込みエラーは無視
  }
}

/**
 * JSDoc完全性チェック
 */
async function checkJSDocCompleteness(
  filePath: string,
  _content: string,
  lines: string[],
  result: QualityCheckResult,
): Promise<void> {
  const methods: Array<{ line: number; name: string }> = [];
  const classes: Array<{ line: number; name: string }> = [];

  // メソッド・クラス・関数の検出
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // クラス定義
    if (line.match(/^(export\s+)?class\s+\w+/)) {
      classes.push({ line: i + 1, name: line });
    }

    // メソッド・関数定義
    if (
      line.match(
        /^\s*(private|public|protected)?\s*(async\s+)?\w+\s*\([^)]*\)\s*:?\s*[^{]*\s*{/,
      ) ||
      line.match(/^(export\s+)?(async\s+)?function\s+\w+/) ||
      line.match(/^\s*\w+\s*=\s*(async\s+)?\([^)]*\)\s*=>/)
    ) {
      methods.push({ line: i + 1, name: line });
    }
  }

  // JSDocの存在チェック
  for (const method of methods) {
    const beforeLine = method.line - 2;
    if (beforeLine > 0) {
      const prevLines = lines
        .slice(Math.max(0, beforeLine - 10), beforeLine)
        .join("\n");

      if (!prevLines.includes("/**") || !prevLines.includes("*/")) {
        result.hasIssues = true;
        result.issues.push(
          `📝 JSDoc不足: ${path.basename(filePath)}:${method.line} - ${method.name.substring(0, 50)}...`,
        );
      }
    }
  }

  // クラスのJSDocチェック
  for (const cls of classes) {
    const beforeLine = cls.line - 2;
    if (beforeLine > 0) {
      const prevLines = lines
        .slice(Math.max(0, beforeLine - 10), beforeLine)
        .join("\n");

      if (!prevLines.includes("/**") || !prevLines.includes("*/")) {
        result.hasIssues = true;
        result.issues.push(
          `📝 クラスJSDoc不足: ${path.basename(filePath)}:${cls.line} - ${cls.name}`,
        );
      }
    }
  }
}

/**
 * 型定義配置チェック
 */
async function checkTypeDefinitions(
  filePath: string,
  content: string,
  result: QualityCheckResult,
): Promise<void> {
  // ファイル内の型定義を検出
  const hasInterface = content.includes("interface ");
  const hasType = content.includes("type ");
  const hasEnum = content.includes("enum ");

  if (
    (hasInterface || hasType || hasEnum) &&
    !filePath.includes("src/types/")
  ) {
    result.hasIssues = true;
    result.issues.push(
      `🏗️ 型定義配置: ${path.basename(filePath)} - 型定義はsrc/types/配下に移動すべき`,
    );
    result.suggestions.push(
      `💡 型定義の移動提案: ${path.basename(filePath)}の型定義をsrc/types/hooks/またはsrc/types/app/に移動`,
    );
  }
}

/**
 * ファイル内共通化チェック
 */
async function checkCommonizationInFile(
  filePath: string,
  content: string,
  result: QualityCheckResult,
): Promise<void> {
  // 共通化候補パターン
  const commonPatterns = [
    {
      pattern: /private\s+log\s*\(/,
      suggestion: "logメソッドをhook-utilsの共通関数に移行",
    },
    {
      pattern: /generateTimestamp|createTimestamp/,
      suggestion: "タイムスタンプ生成をhook-utilsに共通化",
    },
    {
      pattern: /ensureDirector(y|ies)/,
      suggestion: "ディレクトリ作成をhook-utilsに共通化",
    },
    {
      pattern: /fs\.mkdirSync.*recursive/,
      suggestion: "ディレクトリ作成ロジックの共通化を検討",
    },
  ];

  for (const { pattern, suggestion } of commonPatterns) {
    if (pattern.test(content)) {
      result.suggestions.push(
        `🔄 共通化提案: ${path.basename(filePath)} - ${suggestion}`,
      );
    }
  }
}

/**
 * 英語テキストチェック
 */
async function checkEnglishText(
  filePath: string,
  content: string,
  result: QualityCheckResult,
): Promise<void> {
  // 文字列リテラル内の英語をチェック
  const englishPatterns = [
    /"[^"]*[A-Za-z]{4,}[^"]*"/g,
    /'[^']*[A-Za-z]{4,}[^']*'/g,
    /`[^`]*[A-Za-z]{4,}[^`]*`/g,
  ];

  for (const pattern of englishPatterns) {
    const matches = content.match(pattern);
    if (matches) {
      const nonTechnicalMatches = matches.filter((match) => {
        // 技術用語を除外
        const technical = [
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
        ];
        return !technical.some((tech) =>
          match.toLowerCase().includes(tech.toLowerCase()),
        );
      });

      if (nonTechnicalMatches.length > 0) {
        result.suggestions.push(
          `🌏 日本語化提案: ${path.basename(filePath)} - ${nonTechnicalMatches.length}箇所の英語テキストを日本語化`,
        );
      }
    }
  }
}

/**
 * 型組織化チェック
 */
async function checkTypeOrganization(
  result: QualityCheckResult,
): Promise<void> {
  const typesDir = path.join(process.cwd(), "src/types");

  if (!fs.existsSync(typesDir)) {
    result.suggestions.push(
      "🏗️ 型組織化: src/types/ディレクトリが存在しません。型定義の整理を検討してください",
    );
    return;
  }

  const hooksTypesDir = path.join(typesDir, "hooks");
  const appTypesDir = path.join(typesDir, "app");

  if (!fs.existsSync(hooksTypesDir)) {
    result.suggestions.push(
      "🔧 Hook型定義: src/types/hooks/ディレクトリの作成を検討",
    );
  }

  if (!fs.existsSync(appTypesDir)) {
    result.suggestions.push(
      "📱 アプリ型定義: src/types/app/ディレクトリの作成を検討",
    );
  }
}

/**
 * 共通化機会チェック
 */
async function checkCommonizationOpportunities(
  result: QualityCheckResult,
): Promise<void> {
  result.suggestions.push(
    "🔍 共通化チェック: 類似するロジックや重複するユーティリティ関数がないか確認してください",
  );
}

/**
 * メイン実行
 */
async function main(): Promise<any> {
  try {
    const checkResult = await checkQualityCompleteness();

    // Claude Code Hook公式仕様に従った出力
    if (checkResult.hasIssues) {
      const hookResponse = {
        continue: false,
        stopReason: `品質問題を修正してください:\n${checkResult.issues.map((issue) => `• ${issue}`).join("\n")}`,
        systemMessage: `🔍 品質完全性チェック結果:\n\n【検出された問題】\n${checkResult.issues.map((issue) => `• ${issue}`).join("\n")}\n\n【改善提案】\n${checkResult.suggestions.map((suggestion) => `• ${suggestion}`).join("\n")}\n\n【必須対応】\n• JSDocが不足している箇所に包括的な説明を追加\n• 型定義をsrc/types/配下に適切に配置\n• 英語テキストを日本語に変更`,
        suppressOutput: false,
      };

      console.log(JSON.stringify(hookResponse));
      return hookResponse;
    } else if (checkResult.suggestions.length > 0) {
      const hookResponse = {
        continue: false,
        stopReason: `品質改善提案があります:\n${checkResult.suggestions.map((suggestion) => `• ${suggestion}`).join("\n")}`,
        systemMessage: `🔍 品質改善提案:\n\n【改善提案】\n${checkResult.suggestions.map((suggestion) => `• ${suggestion}`).join("\n")}\n\n【推奨対応】\n• 共通化可能なロジックの特定と整理\n• 型定義の適切な配置確認\n• コードスタイルの統一`,
        suppressOutput: false,
      };

      console.log(JSON.stringify(hookResponse));
      return hookResponse;
    } else {
      const hookResponse = {
        continue: true,
        systemMessage: `✅ 品質チェック完了 - 問題なし`,
        suppressOutput: false,
      };

      console.log(JSON.stringify(hookResponse));
      return hookResponse;
    }
  } catch (error) {
    console.error("⚠️ 品質チェック実行エラー:", error);

    const errorResponse = {
      continue: false,
      stopReason: `品質チェック実行エラーのため処理を停止します: ${String(error)}`,
      systemMessage: `❌ 品質チェックシステムエラー\n\nエラー詳細: ${String(error)}\n\n対処法:\n• フックスクリプトの構文確認\n• 必要な依存関係の確認\n• ファイルアクセス権限の確認`,
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
export { checkQualityCompleteness };
