/**
 * テスト実行検証フック
 * E2Eテストファイル編集時の強制実行を徹底
 */

import fs from "fs";
import { execSync } from "child_process";

interface TestExecutionRecord {
  file: string;
  executed: boolean;
  timestamp: string;
  result: "success" | "failure" | "not_executed";
  errorMessage?: string;
}

/**
 * テスト実行記録の管理
 */
class TestExecutionTracker {
  private recordFile = ".claude/test-execution-log.json";

  private loadRecords(): TestExecutionRecord[] {
    if (!fs.existsSync(this.recordFile)) {
      return [];
    }
    try {
      const content = fs.readFileSync(this.recordFile, "utf-8");
      return JSON.parse(content);
    } catch {
      return [];
    }
  }

  private saveRecords(records: TestExecutionRecord[]): void {
    fs.writeFileSync(this.recordFile, JSON.stringify(records, null, 2));
  }

  recordExecution(
    file: string,
    result: "success" | "failure" | "not_executed",
    errorMessage?: string,
  ): void {
    const records = this.loadRecords();
    const record: TestExecutionRecord = {
      file,
      executed: result !== "not_executed",
      timestamp: new Date().toISOString(),
      result,
      errorMessage,
    };

    // 同じファイルの古い記録を削除
    const filteredRecords = records.filter((r) => r.file !== file);
    filteredRecords.push(record);

    this.saveRecords(filteredRecords);
  }

  wasExecuted(file: string): TestExecutionRecord | null {
    const records = this.loadRecords();
    return records.find((r) => r.file === file) || null;
  }

  getUnexecutedTests(): string[] {
    const records = this.loadRecords();
    return records
      .filter((r) => !r.executed || r.result === "failure")
      .map((r) => r.file);
  }
}

/**
 * E2Eテストファイルの検出
 */
function detectE2ETestFiles(): string[] {
  const testFiles: string[] = [];

  try {
    const e2eFiles = execSync("find tests/e2e -name '*.spec.ts' -type f", {
      encoding: "utf-8",
    })
      .trim()
      .split("\n")
      .filter((f) => f.length > 0);

    testFiles.push(...e2eFiles);
  } catch (error) {
    console.warn("E2Eテストファイル検出に失敗:", error);
  }

  return testFiles;
}

/**
 * テストファイルの必須フィールド検証
 */
function validateTestFileContent(filePath: string): string[] {
  const issues: string[] = [];

  if (!fs.existsSync(filePath)) {
    return [`ファイルが存在しません: ${filePath}`];
  }

  try {
    const content = fs.readFileSync(filePath, "utf-8");

    // BatchJob作成時のstatus必須チェック
    if (content.includes("batchJob.create") && !content.includes("status:")) {
      issues.push(`${filePath}: BatchJob.create()でstatusフィールドが必須です`);
    }

    // PrismaClientの適切な初期化チェック
    if (
      content.includes("new PrismaClient()") &&
      !content.includes("datasources")
    ) {
      issues.push(`${filePath}: PrismaClientでdatasources設定が推奨されます`);
    }

    // 必須enumのインポートチェック
    if (content.includes("BatchJobStatus") && !content.includes("import")) {
      issues.push(`${filePath}: BatchJobStatusのインポートが必要です`);
    }
  } catch (error) {
    issues.push(`${filePath}: ファイル読み込みエラー: ${error}`);
  }

  return issues;
}

/**
 * メイン検証関数
 */
export default function verifyTestExecution(): void {
  console.log("🔍 テスト実行検証を開始...");

  const tracker = new TestExecutionTracker();
  const e2eFiles = detectE2ETestFiles();

  if (e2eFiles.length === 0) {
    console.log("ℹ️ E2Eテストファイルが見つかりませんでした。");
    return;
  }

  console.log(`📋 検出されたE2Eテストファイル: ${e2eFiles.length}個`);

  let hasIssues = false;

  for (const file of e2eFiles) {
    console.log(`\n🔍 検証中: ${file}`);

    // ファイル内容の検証
    const contentIssues = validateTestFileContent(file);
    if (contentIssues.length > 0) {
      console.error(`❌ ${file}:内容検証エラー:`);
      contentIssues.forEach((issue) => console.error(`  - ${issue}`));
      hasIssues = true;
      tracker.recordExecution(file, "failure", contentIssues.join("; "));
      continue;
    }

    // 実行記録の確認
    const record = tracker.wasExecuted(file);
    if (!record || record.result !== "success") {
      console.warn(
        `⚠️ ${file}: 最近の成功実行記録がありません。手動実行が必要です。`,
      );
      console.warn(`  実行コマンド: npx playwright test ${file}`);
      hasIssues = true;
    } else {
      console.log(`✅ ${file}: 実行済み (${record.timestamp})`);
    }
  }

  if (hasIssues) {
    console.error("\n❌ テスト実行検証に失敗しました。");
    console.error("🛠️ 上記の問題を修正してから再度実行してください。");
    process.exit(1);
  }

  console.log("\n✅ 全てのE2Eテストファイルが検証に合格しました。");
}

// 実行記録用のヘルパー関数をエクスポート
export function recordTestSuccess(file: string): void {
  const tracker = new TestExecutionTracker();
  tracker.recordExecution(file, "success");
  console.log(`📝 テスト成功を記録: ${file}`);
}

export function recordTestFailure(file: string, error: string): void {
  const tracker = new TestExecutionTracker();
  tracker.recordExecution(file, "failure", error);
  console.log(`📝 テスト失敗を記録: ${file} - ${error}`);
}

// スクリプトとして実行された場合
if (import.meta.url === `file://${process.argv[1]}`) {
  verifyTestExecution();
}
