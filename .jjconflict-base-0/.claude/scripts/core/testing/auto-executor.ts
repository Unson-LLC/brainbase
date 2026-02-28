/**
 * 自動テスト実行システム
 * テストファイル作成・編集時の強制実行とコミットブロック
 */

import fs from "fs";
import path from "path";
import { execSync, spawn } from "child_process";

interface TestExecutionResult {
  file: string;
  executed: boolean;
  success: boolean;
  timestamp: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  duration: number;
}

interface TestConfig {
  unitTestPattern: string[];
  integrationTestPattern: string[];
  e2eTestPattern: string[];
  mandatoryForCommit: string[];
}

class AutoTestExecutor {
  private config: TestConfig = {
    unitTestPattern: ["tests/unit/**/*.test.ts", "tests/unit/**/*.test.tsx"],
    integrationTestPattern: ["tests/integration/**/*.test.ts"],
    e2eTestPattern: ["tests/e2e/**/*.spec.ts"],
    mandatoryForCommit: ["integration", "e2e"], // コミット時必須のテスト種別
  };

  private resultLogFile = ".claude/output/data/test-execution-results.json";

  /**
   * テストファイルの種別判定
   */
  private getTestType(
    filePath: string,
  ): "unit" | "integration" | "e2e" | "jest" | "unknown" {
    if (filePath.includes("tests/unit/")) return "unit";
    if (filePath.includes("tests/integration/")) return "integration";
    if (filePath.includes("tests/e2e/")) return "e2e";
    if (filePath.startsWith("src/")) return "jest";
    return "unknown";
  }

  /**
   * テスト実行コマンドの生成
   */
  private getTestCommand(filePath: string, testType: string): string {
    switch (testType) {
      case "unit":
      case "integration":
        return `npm run test:vitest ${filePath}`;
      case "e2e":
        return `npx playwright test ${filePath}`;
      case "jest":
        return `npm test -- --runTestsByPath "${filePath}"`;
      default:
        throw new Error(`Unknown test type: ${testType}`);
    }
  }

  /**
   * テスト実行（同期的）- AI自動修正機能付き
   */
  private executeTestSync(filePath: string): TestExecutionResult {
    const testType = this.getTestType(filePath);
    const startTime = Date.now();

    console.log(`🧪 [AUTO-TEST] 実行開始: ${filePath} (${testType})`);

    try {
      const command = this.getTestCommand(filePath, testType);
      const result = execSync(command, {
        encoding: "utf-8",
        timeout: 120000, // 2分タイムアウト
        cwd: process.cwd(),
      });

      const duration = Date.now() - startTime;
      const testResult: TestExecutionResult = {
        file: filePath,
        executed: true,
        success: true,
        timestamp: new Date().toISOString(),
        stdout: result.toString(),
        stderr: "",
        exitCode: 0,
        duration,
      };

      console.log(`✅ [AUTO-TEST] 成功: ${filePath} (${duration}ms)`);
      this.saveTestResult(testResult);
      return testResult;
    } catch (error: any) {
      console.error(`❌ [AUTO-TEST] 失敗: ${filePath} - AI自動修正を試行中...`);

      // 🤖 AI自動修正の実行
      try {
        const autoFixResult = execSync(
          `npx tsx .claude/scripts/core/testing/error-fixer.ts ${filePath}`,
          {
            encoding: "utf-8",
            timeout: 300000, // 5分タイムアウト
            cwd: process.cwd(),
          },
        );

        console.log(`🤖 [AUTO-FIX] 自動修正完了: ${filePath}`);

        // 修正後に再実行
        try {
          const retryResult = execSync(command, {
            encoding: "utf-8",
            timeout: 120000,
            cwd: process.cwd(),
          });

          const duration = Date.now() - startTime;
          const testResult: TestExecutionResult = {
            file: filePath,
            executed: true,
            success: true,
            timestamp: new Date().toISOString(),
            stdout: `[AUTO-FIXED] ${retryResult.toString()}`,
            stderr: "",
            exitCode: 0,
            duration,
          };

          console.log(
            `✅ [AUTO-TEST] 自動修正後成功: ${filePath} (${duration}ms)`,
          );
          this.saveTestResult(testResult);
          return testResult;
        } catch (retryError: any) {
          console.error(`❌ [AUTO-TEST] 自動修正後も失敗: ${filePath}`);
        }
      } catch (fixError) {
        console.error(`❌ [AUTO-FIX] 自動修正失敗: ${filePath}`);
      }

      // 最終的に失敗として記録
      const duration = Date.now() - startTime;
      const testResult: TestExecutionResult = {
        file: filePath,
        executed: true,
        success: false,
        timestamp: new Date().toISOString(),
        stdout: error.stdout || "",
        stderr: error.stderr || error.message,
        exitCode: error.status || 1,
        duration,
      };

      console.error(`❌ [AUTO-TEST] 最終失敗: ${filePath} (${duration}ms)`);
      this.saveTestResult(testResult);
      return testResult;
    }
  }

  /**
   * テスト結果の保存
   */
  private saveTestResult(result: TestExecutionResult): void {
    let results: TestExecutionResult[] = [];

    if (fs.existsSync(this.resultLogFile)) {
      try {
        const content = fs.readFileSync(this.resultLogFile, "utf-8");
        results = JSON.parse(content);
      } catch {
        results = [];
      }
    }

    // 同じファイルの古い結果を削除
    results = results.filter((r) => r.file !== result.file);
    results.push(result);

    // 最新50件のみ保持
    if (results.length > 50) {
      results = results.slice(-50);
    }

    fs.writeFileSync(this.resultLogFile, JSON.stringify(results, null, 2));
  }

  /**
   * 最新のテスト結果取得
   */
  private getLatestResult(filePath: string): TestExecutionResult | null {
    if (!fs.existsSync(this.resultLogFile)) {
      return null;
    }

    try {
      const content = fs.readFileSync(this.resultLogFile, "utf-8");
      const results: TestExecutionResult[] = JSON.parse(content);
      return results.find((r) => r.file === filePath) || null;
    } catch {
      return null;
    }
  }

  /**
   * テストファイルの自動検出と実行
   */
  public executeModifiedTests(modifiedFiles: string[]): boolean {
    console.log("🔍 [AUTO-TEST] テストファイル検出中...");

    const testFiles = modifiedFiles.filter(
      (file) =>
        file.includes("/test") ||
        file.endsWith(".test.ts") ||
        file.endsWith(".test.tsx") ||
        file.endsWith(".spec.ts"),
    );

    if (testFiles.length === 0) {
      console.log("ℹ️ [AUTO-TEST] テストファイルが見つかりませんでした。");
      return true;
    }

    console.log(
      `📋 [AUTO-TEST] 検出されたテストファイル: ${testFiles.length}個`,
    );

    let allPassed = true;
    const results: TestExecutionResult[] = [];

    for (const testFile of testFiles) {
      if (!fs.existsSync(testFile)) {
        console.warn(`⚠️ [AUTO-TEST] ファイルが存在しません: ${testFile}`);
        continue;
      }

      const result = this.executeTestSync(testFile);
      results.push(result);

      if (!result.success) {
        allPassed = false;
      }
    }

    // 結果サマリー
    console.log("\n📊 [AUTO-TEST] 実行結果サマリー:");
    results.forEach((result) => {
      const status = result.success ? "✅ 成功" : "❌ 失敗";
      const duration = `${result.duration}ms`;
      console.log(`  ${status} ${result.file} (${duration})`);
    });

    if (!allPassed) {
      console.error("\n❌ [AUTO-TEST] 一部テストが失敗しました。");
      console.error("🛠️ 失敗したテストを修正してからコミットしてください。");
    } else {
      console.log("\n✅ [AUTO-TEST] 全テストが成功しました。");
    }

    return allPassed;
  }

  /**
   * コミット前の必須テスト確認
   */
  public validateForCommit(): boolean {
    console.log("🔒 [COMMIT-GUARD] コミット前必須テスト検証中...");

    if (!fs.existsSync(this.resultLogFile)) {
      console.error("❌ [COMMIT-GUARD] テスト実行履歴が見つかりません。");
      return false;
    }

    try {
      const content = fs.readFileSync(this.resultLogFile, "utf-8");
      const results: TestExecutionResult[] = JSON.parse(content);

      // 過去1時間以内の成功結果のみ有効
      const oneHourAgo = Date.now() - 60 * 60 * 1000;
      const recentResults = results.filter(
        (r) => new Date(r.timestamp).getTime() > oneHourAgo && r.success,
      );

      const hasRecentIntegration = recentResults.some(
        (r) => this.getTestType(r.file) === "integration",
      );
      const hasRecentE2E = recentResults.some(
        (r) => this.getTestType(r.file) === "e2e",
      );

      if (!hasRecentIntegration) {
        console.error(
          "❌ [COMMIT-GUARD] 過去1時間以内の統合テスト成功記録がありません。",
        );
        return false;
      }

      if (!hasRecentE2E) {
        console.error(
          "❌ [COMMIT-GUARD] 過去1時間以内のE2Eテスト成功記録がありません。",
        );
        return false;
      }

      console.log("✅ [COMMIT-GUARD] 必須テスト検証に合格しました。");
      return true;
    } catch (error) {
      console.error("❌ [COMMIT-GUARD] テスト履歴の確認に失敗しました:", error);
      return false;
    }
  }

  /**
   * テスト実行強制フラグの確認
   */
  public checkForceExecutionFlag(): boolean {
    const flagFile = ".claude/force-test-execution";
    return fs.existsSync(flagFile);
  }

  /**
   * 強制実行フラグの設定
   */
  public setForceExecutionFlag(): void {
    const flagFile = ".claude/force-test-execution";
    fs.writeFileSync(flagFile, new Date().toISOString());
    console.log("🚩 [AUTO-TEST] 強制実行フラグを設定しました。");
  }

  /**
   * 強制実行フラグの削除
   */
  public clearForceExecutionFlag(): void {
    const flagFile = ".claude/force-test-execution";
    if (fs.existsSync(flagFile)) {
      fs.unlinkSync(flagFile);
      console.log("🚩 [AUTO-TEST] 強制実行フラグを削除しました。");
    }
  }
}

/**
 * メイン実行関数
 */
export default function autoTestExecution(): void {
  const executor = new AutoTestExecutor();

  // コマンドライン引数の解析
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case "modified":
      // 変更されたファイルのテスト実行
      try {
        const modifiedFiles = execSync("git diff --cached --name-only", {
          encoding: "utf-8",
        })
          .trim()
          .split("\n")
          .filter((f) => f.length > 0);

        const success = executor.executeModifiedTests(modifiedFiles);
        process.exit(success ? 0 : 1);
      } catch (error) {
        console.error("変更ファイルの取得に失敗:", error);
        process.exit(1);
      }
      break;

    case "validate-commit":
      // コミット前検証
      const isValid = executor.validateForCommit();
      process.exit(isValid ? 0 : 1);
      break;

    case "force-flag":
      // 強制実行フラグの設定
      executor.setForceExecutionFlag();
      break;

    case "clear-flag":
      // 強制実行フラグの削除
      executor.clearForceExecutionFlag();
      break;

    case "run":
      {
        const target = args[1];
        if (!target) {
          console.error("❌ 実行するテストファイルを指定してください。");
          process.exit(1);
        }

        if (!fs.existsSync(target)) {
          console.error(`❌ テストファイルが存在しません: ${target}`);
          process.exit(1);
        }

        const success = executor.executeModifiedTests([target]);
        process.exit(success ? 0 : 1);
      }
      break;

    default:
      console.log("使用方法:");
      console.log("  npx tsx .claude/auto-test-execution.ts modified");
      console.log("  npx tsx .claude/auto-test-execution.ts validate-commit");
      console.log("  npx tsx .claude/auto-test-execution.ts force-flag");
      console.log("  npx tsx .claude/auto-test-execution.ts clear-flag");
      console.log(
        "  npx tsx .claude/auto-test-execution.ts run <path/to/test>",
      );
      process.exit(1);
  }
}

// スクリプトとして実行された場合
if (import.meta.url === `file://${process.argv[1]}`) {
  autoTestExecution();
}
