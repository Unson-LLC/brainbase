#!/usr/bin/env npx tsx

/**
 * 設計原則強制システム
 *
 * SOLID原則、KISS、DRY、YAGNIなどの設計原則を
 * システムレベルで強制するための検証・ガイダンスシステムです。
 */

import * as fs from "fs/promises";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

/**
 * 設計原則違反の種類
 */
interface DesignViolation {
  /** 違反原則 */
  principle: string;
  /** ファイルパス */
  file: string;
  /** 行番号 */
  line: number;
  /** 違反内容 */
  message: string;
  /** 修正提案 */
  suggestion: string;
  /** 重要度 */
  severity: "error" | "warning" | "info";
}

/**
 * 設計原則強制クラス
 */
class DesignPrincipleEnforcer {
  private violations: DesignViolation[] = [];

  /**
   * 指定されたファイルの設計原則をチェックします。
   * @param filePath チェック対象ファイルのパス
   */
  public async checkDesignPrinciples(
    filePath: string,
  ): Promise<DesignViolation[]> {
    this.violations = [];

    console.log(`🔍 チェック対象: ${filePath}`);

    if (!(await this.isTargetFile(filePath))) {
      console.log(`⏭️  スキップ: 対象外ファイル`);
      return this.violations;
    }

    const content = await fs.readFile(filePath, "utf8");
    const lines = content.split("\n");
    console.log(`📄 ファイル読み込み完了: ${lines.length}行`);

    // 各設計原則のチェック
    console.log("🔎 型定義分離チェック開始...");
    await this.checkTypeDefinitionSeparation(filePath, lines);
    console.log(`📊 型定義分離チェック完了。違反数: ${this.violations.length}`);

    await this.checkSingleResponsibilityPrinciple(filePath, lines);
    await this.checkDRYPrinciple(filePath, lines);
    await this.checkKISSPrinciple(filePath, lines);
    await this.checkYAGNIPrinciple(filePath, lines);
    await this.checkInterfaceSegregation(filePath, lines);
    await this.checkDependencyInversion(filePath, lines);

    console.log(`✅ 全チェック完了。総違反数: ${this.violations.length}`);
    return this.violations;
  }

  /**
   * チェック対象ファイルかどうかを判定します。
   */
  private async isTargetFile(filePath: string): Promise<boolean> {
    return (
      /\.(ts|tsx|js|jsx)$/.test(filePath) &&
      !filePath.includes("node_modules") &&
      !filePath.includes(".next") &&
      !filePath.includes("dist")
    );
    // testファイルも含めてチェック対象とする
  }

  /**
   * 単一責任の原則（SRP）をチェックします。
   */
  private async checkSingleResponsibilityPrinciple(
    filePath: string,
    lines: string[],
  ): Promise<void> {
    let classCount = 0;
    let functionCount = 0;
    let _currentClass = "";

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // クラス定義の検出
      const classMatch = line.match(/(?:export\s+)?class\s+(\w+)/);
      if (classMatch) {
        classCount++;
        _currentClass = classMatch[1];
      }

      // 関数定義の検出
      const functionMatch = line.match(
        /(?:export\s+)?(?:async\s+)?function\s+(\w+)|(\w+)\s*[=:]\s*(?:async\s+)?\(/,
      );
      if (functionMatch) {
        functionCount++;
      }

      // 長すぎる関数の検出
      if (functionMatch) {
        const functionEnd = this.findFunctionEnd(lines, i);
        const functionLength = functionEnd - i;

        if (functionLength > 50) {
          this.addViolation({
            principle: "SRP (Single Responsibility)",
            file: filePath,
            line: i + 1,
            message: `関数が長すぎます (${functionLength}行)。単一の責任に分割してください。`,
            suggestion:
              "関数を複数の小さな関数に分割し、それぞれが単一の責任を持つようにしてください。",
            severity: "warning",
          });
        }
      }
    }

    // 1ファイルに複数クラスがある場合
    if (classCount > 1) {
      this.addViolation({
        principle: "SRP (Single Responsibility)",
        file: filePath,
        line: 1,
        message: `1ファイルに${classCount}個のクラスが定義されています。`,
        suggestion: "各クラスを別々のファイルに分離してください。",
        severity: "warning",
      });
    }

    // ファイルが長すぎる場合
    if (lines.length > 300) {
      this.addViolation({
        principle: "SRP (Single Responsibility)",
        file: filePath,
        line: 1,
        message: `ファイルが長すぎます (${lines.length}行)。複数の責任を持っている可能性があります。`,
        suggestion:
          "ファイルを機能ごとに分割し、各ファイルが単一の責任を持つようにしてください。",
        severity: "info",
      });
    }
  }

  /**
   * DRY原則をチェックします。
   */
  private async checkDRYPrinciple(
    filePath: string,
    lines: string[],
  ): Promise<void> {
    const codeBlocks = new Map<string, number[]>();
    const consecutiveBlocks = new Map<string, number[]>();

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // 空行やコメントをスキップ
      if (
        !line ||
        line.startsWith("//") ||
        line.startsWith("/*") ||
        line.startsWith("*")
      ) {
        continue;
      }

      // console.log文や単純な代入文など、意味のあるコードのみ対象
      if (line.length > 25 && !line.match(/^[{}\]\[;,]$/)) {
        // 変数名や文字列リテラルを正規化
        const normalized = line
          .replace(/(['"`])(?:(?!\1)[^\\]|\\.)*\1/g, "STRING") // 文字列を正規化
          .replace(/\b\d+\b/g, "NUMBER") // 数値を正規化
          .replace(/\s+/g, " ") // 空白を正規化
          .replace(/\b[a-zA-Z_$][a-zA-Z0-9_$]*\b/g, (match) => {
            // 予約語や一般的なメソッド名はそのまま
            if (
              [
                "console",
                "log",
                "if",
                "else",
                "return",
                "const",
                "let",
                "var",
                "function",
              ].includes(match)
            ) {
              return match;
            }
            return "IDENTIFIER";
          });

        if (codeBlocks.has(normalized)) {
          codeBlocks.get(normalized)!.push(i + 1);
        } else {
          codeBlocks.set(normalized, [i + 1]);
        }
      }

      // 連続する類似行をチェック（3行以上）
      if (i >= 2) {
        const currentPattern = lines
          .slice(i - 2, i + 1)
          .map((l) => l.trim())
          .filter((l) => l && !l.startsWith("//") && !l.startsWith("/*"))
          .join("|");

        if (currentPattern && currentPattern.split("|").length === 3) {
          const normalized = currentPattern.replace(
            /(['"`])(?:(?!\1)[^\\]|\\.)*\1/g,
            "STRING",
          );
          if (consecutiveBlocks.has(normalized)) {
            consecutiveBlocks.get(normalized)!.push(i - 1);
          } else {
            consecutiveBlocks.set(normalized, [i - 1]);
          }
        }
      }
    }

    // 重複の報告（より厳密に）
    for (const [_code, lineNumbers] of codeBlocks) {
      if (lineNumbers.length >= 3) {
        // 3回以上の重複のみ報告
        this.addViolation({
          principle: "DRY (Don't Repeat Yourself)",
          file: filePath,
          line: lineNumbers[0],
          message: `同様のコードが${lineNumbers.length}箇所で重複しています (行: ${lineNumbers.join(", ")})`,
          suggestion:
            "共通化できるロジックを関数やモジュールとして抽出してください。",
          severity: "warning",
        });
      }
    }

    // 連続する重複パターンの報告
    for (const [_pattern, startLines] of consecutiveBlocks) {
      if (startLines.length >= 2) {
        this.addViolation({
          principle: "DRY (Don't Repeat Yourself)",
          file: filePath,
          line: startLines[0],
          message: `連続する類似パターンが${startLines.length}箇所で検出されました`,
          suggestion: "ループや関数を使用して重複を削減してください。",
          severity: "warning",
        });
      }
    }
  }

  /**
   * KISS原則をチェックします。
   */
  private async checkKISSPrinciple(
    filePath: string,
    lines: string[],
  ): Promise<void> {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmedLine = line.trim();

      // 空行やコメント行をスキップ
      if (
        !trimmedLine ||
        trimmedLine.startsWith("//") ||
        trimmedLine.startsWith("/*") ||
        trimmedLine.startsWith("*")
      ) {
        continue;
      }

      // より正確なインデントレベル計算（タブも考慮）
      const indentMatch = line.match(/^(\s*)/);
      const indentStr = indentMatch ? indentMatch[1] : "";
      const indentLevel = indentStr.replace(/\t/g, "  ").length / 2;

      if (indentLevel > 6) {
        this.addViolation({
          principle: "KISS (Keep It Simple)",
          file: filePath,
          line: i + 1,
          message: `ネストが深すぎます (レベル${Math.round(indentLevel)})。`,
          suggestion:
            "早期return、関数抽出、ガード句を使用してネストを浅くしてください。",
          severity: "warning",
        });
      }

      // 複雑な条件式の検出（より厳密に）
      const ifMatch = line.match(/if\s*\(([^)]+)\)/);
      if (ifMatch && ifMatch[1].length > 60) {
        const conditionCount = (ifMatch[1].match(/&&|\|\|/g) || []).length;
        if (conditionCount >= 3) {
          this.addViolation({
            principle: "KISS (Keep It Simple)",
            file: filePath,
            line: i + 1,
            message: `条件式が複雑すぎます (${conditionCount + 1}個の条件)。`,
            suggestion:
              "条件式を複数行に分割するか、説明的な変数に抽出してください。",
            severity: "warning",
          });
        }
      }

      // 長いメソッドチェーンの検出（コメント除外）
      const chainMatch = trimmedLine.match(
        /[a-zA-Z_$][a-zA-Z0-9_$]*(?:\.[a-zA-Z_$][a-zA-Z0-9_$]*){4,}/,
      );
      if (chainMatch) {
        const chainLength = (chainMatch[0].match(/\./g) || []).length;
        this.addViolation({
          principle: "KISS (Keep It Simple)",
          file: filePath,
          line: i + 1,
          message: `メソッドチェーンが長すぎます (${chainLength}レベル)。`,
          suggestion: "中間変数を使用して処理を段階的に行ってください。",
          severity: "info",
        });
      }
    }
  }

  /**
   * YAGNI原則をチェックします。
   */
  private async checkYAGNIPrinciple(
    filePath: string,
    lines: string[],
  ): Promise<void> {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // 未使用のインポートの検出
      const importMatch = line.match(/import\s+.*\s+from/);
      if (importMatch) {
        // ESLintの未使用インポート検出に委ねる
      }

      // 将来対応のコメント検出
      const futureComment = line.match(
        /\/\/.*(?:TODO|FIXME|XXX|HACK|future|later|someday)/i,
      );
      if (futureComment) {
        this.addViolation({
          principle: "YAGNI (You Ain't Gonna Need It)",
          file: filePath,
          line: i + 1,
          message: "将来対応のコメントが見つかりました。",
          suggestion:
            "現在必要でない場合は実装を控えるか、具体的な計画がある場合はIssueとして管理してください。",
          severity: "info",
        });
      }

      // 過度な抽象化の検出
      const abstractPattern = line.match(
        /abstract|interface.*Factory|.*Builder|.*Strategy/,
      );
      if (abstractPattern && !line.includes("//")) {
        this.addViolation({
          principle: "YAGNI (You Ain't Gonna Need It)",
          file: filePath,
          line: i + 1,
          message: "抽象化パターンが検出されました。本当に必要ですか？",
          suggestion:
            "現在の要求に対してよりシンプルな実装で十分でないか検討してください。",
          severity: "info",
        });
      }
    }
  }

  /**
   * インターフェース分離原則をチェックします。
   */
  private async checkInterfaceSegregation(
    filePath: string,
    lines: string[],
  ): Promise<void> {
    let interfaceMethodCount = 0;
    let currentInterface = "";

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // インターフェース定義の開始
      const interfaceMatch = line.match(/interface\s+(\w+)/);
      if (interfaceMatch) {
        currentInterface = interfaceMatch[1];
        interfaceMethodCount = 0;
      }

      // メソッド定義のカウント
      if (
        currentInterface &&
        line.match(/^\s*\w+\s*[\(:]/) &&
        !line.includes("}")
      ) {
        interfaceMethodCount++;
      }

      // インターフェース終了時のチェック
      if (currentInterface && line.includes("}") && interfaceMethodCount > 10) {
        this.addViolation({
          principle: "ISP (Interface Segregation)",
          file: filePath,
          line: i + 1,
          message: `インターフェース ${currentInterface} が大きすぎます (${interfaceMethodCount}メソッド)。`,
          suggestion: "インターフェースを責任ごとに分割してください。",
          severity: "warning",
        });
        currentInterface = "";
      }
    }
  }

  /**
   * 依存性逆転原則をチェックします。
   */
  private async checkDependencyInversion(
    filePath: string,
    lines: string[],
  ): Promise<void> {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // 具象クラスの直接インスタンス化
      const directInstantiation = line.match(/new\s+([A-Z]\w+)\s*\(/);
      if (
        directInstantiation &&
        !line.includes("Date") &&
        !line.includes("Error")
      ) {
        this.addViolation({
          principle: "DIP (Dependency Inversion)",
          file: filePath,
          line: i + 1,
          message: `具象クラス ${directInstantiation[1]} を直接インスタンス化しています。`,
          suggestion:
            "インターフェースに依存し、依存性注入を使用してください。",
          severity: "info",
        });
      }
    }
  }

  /**
   * 型定義分離をチェックします。
   */
  private async checkTypeDefinitionSeparation(
    filePath: string,
    lines: string[],
  ): Promise<void> {
    let hasTypeDefinition = false;
    let hasImplementation = false;
    let typeDefLines: number[] = [];
    let implLines: number[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // コメント行をスキップ
      if (
        line.startsWith("//") ||
        line.startsWith("/*") ||
        line.startsWith("*")
      ) {
        continue;
      }

      // 型定義の検出（より厳密に）
      if (line.match(/^(?:export\s+)?(?:interface|type)\s+[A-Z]\w*/)) {
        hasTypeDefinition = true;
        typeDefLines.push(i + 1);
      }

      // 実装の検出（より厳密に）
      if (
        line.match(
          /^(?:export\s+)?(?:class\s+[A-Z]\w*|function\s+\w+|const\s+\w+\s*[=:]|let\s+\w+\s*[=:]|var\s+\w+\s*[=:])/,
        )
      ) {
        hasImplementation = true;
        implLines.push(i + 1);
      }

      // アロー関数の検出
      if (line.match(/^(?:export\s+)?const\s+\w+\s*=\s*(?:\([^)]*\)\s*)?=>/)) {
        hasImplementation = true;
        implLines.push(i + 1);
      }
    }

    // 型定義と実装が同じファイルにある場合（src/types以外）
    if (
      hasTypeDefinition &&
      hasImplementation &&
      !filePath.includes("src/types/")
    ) {
      this.addViolation({
        principle: "Type Definition Separation (Project Rule)",
        file: filePath,
        line: typeDefLines[0] || 1,
        message: `型定義（行${typeDefLines.join(", ")}）と実装（行${implLines.join(", ")}）が同じファイルに混在しています。`,
        suggestion:
          '型定義を src/types/ ディレクトリに分離し、import type { ... } from "../types/[module-name]" で参照してください。',
        severity: "error",
      });
    }
  }

  /**
   * 関数の終了行を見つけます。
   */
  private findFunctionEnd(lines: string[], startLine: number): number {
    let braceCount = 0;
    let inFunction = false;
    let parenthesesCount = 0;
    let foundOpenBrace = false;

    for (let i = startLine; i < lines.length; i++) {
      const line = lines[i];

      // 文字列内の括弧を除外するため、簡単なチェック
      const cleanLine = line.replace(/(['"`])(?:(?!\1)[^\\]|\\.)*\1/g, "");

      // 関数定義行でのパラメータ括弧をカウント
      if (i === startLine) {
        parenthesesCount += (cleanLine.match(/\(/g) || []).length;
        parenthesesCount -= (cleanLine.match(/\)/g) || []).length;
      }

      // 開き括弧を探す
      if (cleanLine.includes("{")) {
        braceCount += (cleanLine.match(/\{/g) || []).length;
        inFunction = true;
        foundOpenBrace = true;
      }

      if (cleanLine.includes("}")) {
        braceCount -= (cleanLine.match(/\}/g) || []).length;
        if (inFunction && braceCount <= 0) {
          return i;
        }
      }

      // アロー関数で波括弧がない場合（単一式）
      if (
        i === startLine &&
        cleanLine.includes("=>") &&
        !cleanLine.includes("{")
      ) {
        // 次の行がセミコロンで終わるか、次の関数定義まで
        for (let j = i + 1; j < lines.length; j++) {
          if (
            lines[j].trim().endsWith(";") ||
            lines[j].match(/^\s*(?:export\s+)?(?:const|let|var|function|class)/)
          ) {
            return j;
          }
        }
        return i; // 単一行のアロー関数
      }

      // 100行を超える場合は強制終了（無限ループ防止）
      if (i - startLine > 100) {
        return i;
      }
    }

    return lines.length - 1;
  }

  /**
   * 違反を追加します。
   */
  private addViolation(violation: DesignViolation): void {
    this.violations.push(violation);
  }

  /**
   * 違反レポートを出力します。
   */
  public generateReport(): string {
    if (this.violations.length === 0) {
      return "✅ 設計原則違反は検出されませんでした。";
    }

    let report = `\n📋 設計原則チェック結果: ${this.violations.length}件の問題\n`;
    report += "=".repeat(80) + "\n";

    const groupedViolations = this.groupViolationsByPrinciple();

    for (const [principle, violations] of groupedViolations) {
      report += `\n🔍 ${principle}:\n`;

      for (const violation of violations) {
        const icon =
          violation.severity === "error"
            ? "❌"
            : violation.severity === "warning"
              ? "⚠️"
              : "ℹ️";
        report += `  ${icon} ${violation.file}:${violation.line}\n`;
        report += `     ${violation.message}\n`;
        report += `     💡 ${violation.suggestion}\n\n`;
      }
    }

    return report;
  }

  /**
   * 違反を原則別にグループ化します。
   */
  private groupViolationsByPrinciple(): Map<string, DesignViolation[]> {
    const grouped = new Map<string, DesignViolation[]>();

    for (const violation of this.violations) {
      if (!grouped.has(violation.principle)) {
        grouped.set(violation.principle, []);
      }
      grouped.get(violation.principle)!.push(violation);
    }

    return grouped;
  }
}

/**
 * 複数ファイルの設計原則をチェックします。
 */
async function checkMultipleFiles(filePaths: string[]): Promise<void> {
  const enforcer = new DesignPrincipleEnforcer();
  let allViolations: DesignViolation[] = [];

  console.log("🔍 設計原則チェック開始...\n");

  for (const filePath of filePaths) {
    const violations = await enforcer.checkDesignPrinciples(filePath);
    allViolations = allViolations.concat(violations);
  }

  // レポート生成
  const report = enforcer.generateReport();
  console.log(report);

  // 重要な違反がある場合は警告
  const errors = allViolations.filter((v) => v.severity === "error");
  if (errors.length > 0) {
    console.log(
      `\n🚨 ${errors.length}件の重要な設計原則違反があります。修正を推奨します。`,
    );
  }
}

/**
 * メイン処理
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    // Git差分から変更ファイルを取得
    try {
      const { stdout } = await execAsync(
        "git diff --cached --name-only && git diff --name-only",
      );
      const files = stdout
        .trim()
        .split("\n")
        .filter(Boolean)
        .filter((file) => /\.(ts|tsx|js|jsx)$/.test(file));

      if (files.length === 0) {
        console.log("📝 チェック対象ファイルがありません");
        return;
      }

      await checkMultipleFiles(files);
    } catch (error) {
      console.error("❌ Git差分取得エラー:", error);
    }
  } else {
    // 指定されたファイルをチェック
    await checkMultipleFiles(args);
  }
}

// 直接実行された場合
if (process.argv[1] === import.meta.url.replace("file://", "")) {
  main().catch(console.error);
}
