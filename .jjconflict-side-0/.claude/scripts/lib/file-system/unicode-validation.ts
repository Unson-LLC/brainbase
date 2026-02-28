#!/usr/bin/env tsx
/**
 * Unicode/ByteString問題の自動検証システム
 * ByteStringエラーを事前に検出・防止する
 */

import fs from "fs";
import path from "path";
import { glob } from "glob";
import type {
  UnicodeIssue,
  ValidationResult,
} from "../../../../src/types/unicode-validation.js";

/**
 * Unicode/ByteString問題の検証を行うクラス
 * Resend APIでのByteStringエラーを防ぐため、ASCII範囲外の文字を検出する
 * @example
 * ```typescript
 * const result = await UnicodeValidator.validateDirectory('./src');
 * console.log(UnicodeValidator.formatResults(result));
 * ```
 */
class UnicodeValidator {
  /**
   * 検証対象となる正規表現パターン
   * エラーメッセージ、ログメッセージ、環境変数使用箇所で問題文字を検出
   */
  private static readonly PATTERNS = {
    // エラーメッセージ（ASCII必須）
    errorMessages:
      /(?:throw new Error|console\.error|NextResponse\.json.*message)\s*\(\s*["'`]([^"'`]*[^\x00-\x7F][^"'`]*)["'`]/g,

    // 日本語文字検出
    japaneseChars: /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/g,

    // 環境変数内の問題文字
    envVarUsage:
      /process\.env\.[A-Z_]+.*["'`]([^"'`]*[^\x00-\x7F][^"'`]*)["'`]/g,

    // ログメッセージ内の日本語
    logMessages:
      /console\.(log|warn|error|info)\s*\(\s*["'`]([^"'`]*[^\x00-\x7F][^"'`]*)["'`]/g,
  };

  /**
   * 指定されたディレクトリ内のファイルを検証
   * TypeScript/JavaScriptファイルを対象にUnicode文字の問題を検出
   * @param dir 検証対象のディレクトリパス
   * @returns 検証結果（問題箇所の詳細と統計情報）
   * @throws {Error} ディレクトリが存在しない場合
   */
  public static async validateDirectory(
    dir: string,
  ): Promise<ValidationResult> {
    const files = await glob("**/*.{ts,tsx,js,jsx}", {
      cwd: dir,
      ignore: [
        "node_modules/**",
        ".next/**",
        "dist/**",
        "**/*.test.*",
        "**/*.spec.*",
      ],
    });

    const issues: UnicodeIssue[] = [];
    let filesWithIssues = 0;

    for (const file of files) {
      const fullPath = path.join(dir, file);
      const fileIssues = await this.validateFile(fullPath);
      if (fileIssues.length > 0) {
        issues.push(...fileIssues);
        filesWithIssues++;
      }
    }

    return {
      issues,
      summary: {
        totalFiles: files.length,
        filesWithIssues,
        totalIssues: issues.length,
        errorCount: issues.filter((i) => i.severity === "error").length,
        warningCount: issues.filter((i) => i.severity === "warning").length,
      },
    };
  }

  /**
   * 単一ファイルの検証
   * ファイル内容を行ごとに解析し、問題のあるUnicode文字を検出
   * @param filePath 検証対象のファイルパス
   * @returns 検出された問題箇所の配列
   */
  private static async validateFile(filePath: string): Promise<UnicodeIssue[]> {
    if (!fs.existsSync(filePath)) return [];

    const content = fs.readFileSync(filePath, "utf-8");
    const lines = content.split("\n");
    const issues: UnicodeIssue[] = [];

    lines.forEach((line, lineIndex) => {
      // エラーメッセージ内の日本語チェック（重要度：エラー）
      this.checkPattern(
        line,
        this.PATTERNS.errorMessages,
        filePath,
        lineIndex + 1,
        "error",
        "エラーメッセージはByteString互換性のためASCII文字のみ使用してください",
        issues,
      );

      // ログメッセージ内の日本語チェック（重要度：警告）
      this.checkPattern(
        line,
        this.PATTERNS.logMessages,
        filePath,
        lineIndex + 1,
        "warning",
        "ログメッセージはデバッグのため英語で記述することを推奨します",
        issues,
      );

      // 環境変数内の問題文字チェック（重要度：エラー）
      this.checkPattern(
        line,
        this.PATTERNS.envVarUsage,
        filePath,
        lineIndex + 1,
        "error",
        "環境変数にはASCII文字以外を含めないでください",
        issues,
      );
    });

    return issues;
  }

  /**
   * パターンマッチングによる問題検出
   * 指定した正規表現パターンに一致する箇所でUnicode文字をチェック
   * @param line 検証対象の行テキスト
   * @param pattern 検証に使用する正規表現
   * @param filePath ファイルパス（エラー報告用）
   * @param lineNumber 行番号（エラー報告用）
   * @param severity 問題の重要度（error または warning）
   * @param suggestion 修正提案メッセージ
   * @param issues 検出された問題を追加する配列
   */
  private static checkPattern(
    line: string,
    pattern: RegExp,
    filePath: string,
    lineNumber: number,
    severity: "error" | "warning",
    suggestion: string,
    issues: UnicodeIssue[],
  ): void {
    pattern.lastIndex = 0; // グローバル正規表現のリセット
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(line)) !== null) {
      const text = match[1] || match[0];
      const problematicChars = Array.from(text).filter(
        (char: string) => char.charCodeAt(0) > 255,
      );

      if (problematicChars.length > 0) {
        problematicChars.forEach((char: string) => {
          issues.push({
            file: filePath,
            line: lineNumber,
            column: match!.index + 1,
            text: text,
            problematicChar: char,
            charCode: char.charCodeAt(0),
            severity,
            suggestion,
          });
        });
      }
    }
  }

  /**
   * 検証結果をフォーマット出力
   * 人間が読みやすい形式で検証結果を整形
   * @param result 検証結果オブジェクト
   * @returns フォーマットされた検証結果文字列
   */
  public static formatResults(result: ValidationResult): string {
    const { issues, summary } = result;

    let output = "\n🔍 Unicode/ByteString 検証レポート\n";
    output += "=".repeat(50) + "\n\n";

    // サマリー
    output += `📊 サマリー:\n`;
    output += `  スキャンしたファイル数: ${summary.totalFiles}\n`;
    output += `  問題のあるファイル数: ${summary.filesWithIssues}\n`;
    output += `  総問題数: ${summary.totalIssues}\n`;
    output += `  エラー: ${summary.errorCount}\n`;
    output += `  警告: ${summary.warningCount}\n\n`;

    if (issues.length === 0) {
      output += "✅ Unicode/ByteStringの問題は見つかりませんでした！\n";
      return output;
    }

    // エラー詳細
    output += "🚨 発見された問題:\n\n";

    const groupedIssues = this.groupIssuesByFile(issues);

    for (const [file, fileIssues] of Object.entries(groupedIssues)) {
      output += `📄 ${file}\n`;

      fileIssues.forEach((issue) => {
        const icon = issue.severity === "error" ? "❌" : "⚠️";
        output += `  ${icon} Line ${issue.line}:${issue.column}\n`;
        output += `     文字: "${issue.problematicChar}" (Unicode: ${issue.charCode})\n`;
        output += `     テキスト: "${issue.text}"\n`;
        output += `     提案: ${issue.suggestion}\n\n`;
      });
    }

    return output;
  }

  /**
   * ファイル別にissueをグループ化
   * 検出された問題をファイル単位でまとめて整理
   * @param issues 検出された問題の配列
   * @returns ファイルパスをキーとした問題のグループ
   */
  private static groupIssuesByFile(
    issues: UnicodeIssue[],
  ): Record<string, UnicodeIssue[]> {
    return issues.reduce(
      (groups, issue) => {
        const relativePath = path.relative(process.cwd(), issue.file);
        if (!groups[relativePath]) groups[relativePath] = [];
        groups[relativePath].push(issue);
        return groups;
      },
      {} as Record<string, UnicodeIssue[]>,
    );
  }
}

/**
 * CLI実行部分
 * コマンドライン引数を解析してUnicode検証を実行
 * @throws {Error} 検証対象ディレクトリが存在しない場合
 */
async function main() {
  const targetDir = process.argv[2] || "./src";

  console.log(
    `🔍 ${targetDir} をUnicode/ByteString問題についてスキャンしています...`,
  );

  try {
    const result = await UnicodeValidator.validateDirectory(targetDir);
    const output = UnicodeValidator.formatResults(result);

    console.log(output);

    // エラーがある場合は終了コード1で終了
    if (result.summary.errorCount > 0) {
      console.error(
        "❌ 検証がエラーで失敗しました。上記の問題を修正してください。",
      );
      process.exit(1);
    } else if (result.summary.warningCount > 0) {
      console.warn("⚠️ 検証が警告付きで完了しました。");
      process.exit(0);
    } else {
      console.log("✅ 検証が正常に完了しました！");
      process.exit(0);
    }
  } catch (error) {
    console.error("❌ 検証に失敗しました:", error);
    process.exit(1);
  }
}

// スクリプトとして実行された場合のみmainを実行
if (process.argv[1] === new URL(import.meta.url).pathname) {
  main();
}

export { UnicodeValidator };
export type {
  UnicodeIssue,
  ValidationResult,
} from "../../../../src/types/unicode-validation.js";
