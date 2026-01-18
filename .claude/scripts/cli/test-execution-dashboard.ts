/**
 * テスト実行状況ダッシュボード
 * テスト実行履歴の可視化と品質監視
 */

import fs from "fs";
import path from "path";

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

interface DashboardReport {
  summary: {
    totalTests: number;
    successfulTests: number;
    failedTests: number;
    notExecutedTests: number;
    successRate: number;
    lastUpdate: string;
  };
  recentResults: TestExecutionResult[];
  testsByType: {
    unit: TestExecutionResult[];
    integration: TestExecutionResult[];
    e2e: TestExecutionResult[];
  };
  qualityMetrics: {
    avgExecutionTime: number;
    mostRecentFailures: TestExecutionResult[];
    oldestTests: TestExecutionResult[];
  };
}

class TestExecutionDashboard {
  private resultLogFile = ".claude/output/data/test-execution-results.json";
  private dashboardFile = ".claude/output/reports/test-dashboard-report.json";

  /**
   * テスト結果の読み込み
   */
  private loadTestResults(): TestExecutionResult[] {
    if (!fs.existsSync(this.resultLogFile)) {
      return [];
    }

    try {
      const content = fs.readFileSync(this.resultLogFile, "utf-8");
      return JSON.parse(content);
    } catch (error) {
      console.error("テスト結果の読み込みに失敗:", error);
      return [];
    }
  }

  /**
   * テスト種別の判定
   */
  private getTestType(filePath: string): "unit" | "integration" | "e2e" {
    if (filePath.includes("tests/unit/")) return "unit";
    if (filePath.includes("tests/integration/")) return "integration";
    if (filePath.includes("tests/e2e/")) return "e2e";
    return "unit"; // デフォルト
  }

  /**
   * ダッシュボードレポートの生成
   */
  public generateReport(): DashboardReport {
    const results = this.loadTestResults();
    const now = new Date().toISOString();

    // 基本統計
    const totalTests = results.length;
    const successfulTests = results.filter((r) => r.success).length;
    const failedTests = results.filter((r) => !r.success && r.executed).length;
    const notExecutedTests = results.filter((r) => !r.executed).length;
    const successRate =
      totalTests > 0 ? (successfulTests / totalTests) * 100 : 0;

    // 種別ごとの分類
    const testsByType = {
      unit: results.filter((r) => this.getTestType(r.file) === "unit"),
      integration: results.filter(
        (r) => this.getTestType(r.file) === "integration",
      ),
      e2e: results.filter((r) => this.getTestType(r.file) === "e2e"),
    };

    // 品質メトリクス
    const executedResults = results.filter((r) => r.executed);
    const avgExecutionTime =
      executedResults.length > 0
        ? executedResults.reduce((sum, r) => sum + r.duration, 0) /
          executedResults.length
        : 0;

    const mostRecentFailures = results
      .filter((r) => !r.success)
      .sort(
        (a, b) =>
          new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
      )
      .slice(0, 5);

    const oldestTests = results
      .sort(
        (a, b) =>
          new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
      )
      .slice(0, 5);

    const recentResults = results
      .sort(
        (a, b) =>
          new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
      )
      .slice(0, 10);

    const report: DashboardReport = {
      summary: {
        totalTests,
        successfulTests,
        failedTests,
        notExecutedTests,
        successRate,
        lastUpdate: now,
      },
      recentResults,
      testsByType,
      qualityMetrics: {
        avgExecutionTime,
        mostRecentFailures,
        oldestTests,
      },
    };

    // レポートファイルに保存
    fs.writeFileSync(this.dashboardFile, JSON.stringify(report, null, 2));

    return report;
  }

  /**
   * コンソール表示用レポート
   */
  public displayReport(): void {
    const report = this.generateReport();

    console.log("\n" + "=".repeat(60));
    console.log("🎯 テスト実行品質ダッシュボード");
    console.log("=".repeat(60));

    // サマリー
    console.log("\n📊 実行サマリー:");
    console.log(`  総テスト数: ${report.summary.totalTests}`);
    console.log(
      `  成功: ${report.summary.successfulTests} (${report.summary.successRate.toFixed(1)}%)`,
    );
    console.log(`  失敗: ${report.summary.failedTests}`);
    console.log(`  未実行: ${report.summary.notExecutedTests}`);
    console.log(
      `  最終更新: ${new Date(report.summary.lastUpdate).toLocaleString()}`,
    );

    // 種別ごとの統計
    console.log("\n📋 テスト種別統計:");
    Object.entries(report.testsByType).forEach(([type, tests]) => {
      const successCount = tests.filter((t) => t.success).length;
      const totalCount = tests.length;
      const rate = totalCount > 0 ? (successCount / totalCount) * 100 : 0;
      console.log(
        `  ${type.toUpperCase()}: ${successCount}/${totalCount} (${rate.toFixed(1)}%)`,
      );
    });

    // 品質メトリクス
    console.log("\n⚡ 品質メトリクス:");
    console.log(
      `  平均実行時間: ${report.qualityMetrics.avgExecutionTime.toFixed(0)}ms`,
    );

    // 最近の失敗
    if (report.qualityMetrics.mostRecentFailures.length > 0) {
      console.log("\n❌ 最近の失敗:");
      report.qualityMetrics.mostRecentFailures.forEach((failure) => {
        const timeAgo = this.getTimeAgo(failure.timestamp);
        console.log(`  ${failure.file} (${timeAgo})`);
      });
    }

    // 最近の実行結果
    console.log("\n🔄 最近の実行結果:");
    report.recentResults.slice(0, 5).forEach((result) => {
      const status = result.success ? "✅" : "❌";
      const timeAgo = this.getTimeAgo(result.timestamp);
      const duration = `${result.duration}ms`;
      console.log(`  ${status} ${result.file} (${timeAgo}, ${duration})`);
    });

    // 警告
    if (report.summary.successRate < 80) {
      console.log("\n⚠️ 警告: テスト成功率が80%を下回っています！");
    }

    if (report.summary.notExecutedTests > 0) {
      console.log(
        `\n⚠️ 警告: ${report.summary.notExecutedTests}個のテストが未実行です！`,
      );
    }

    console.log("\n" + "=".repeat(60));
  }

  /**
   * 時間の相対表示
   */
  private getTimeAgo(timestamp: string): string {
    const now = new Date();
    const then = new Date(timestamp);
    const diffMs = now.getTime() - then.getTime();
    const diffMinutes = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMinutes / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffDays > 0) return `${diffDays}日前`;
    if (diffHours > 0) return `${diffHours}時間前`;
    if (diffMinutes > 0) return `${diffMinutes}分前`;
    return "1分以内";
  }

  /**
   * 品質チェック（コミット前検証用）
   */
  public validateQuality(): boolean {
    const report = this.generateReport();

    console.log("🔍 テスト品質検証中...");

    let isValid = true;

    // 成功率チェック
    if (report.summary.successRate < 90) {
      console.error(
        `❌ テスト成功率が基準値を下回っています: ${report.summary.successRate.toFixed(1)}% < 90%`,
      );
      isValid = false;
    }

    // 未実行テストチェック
    if (report.summary.notExecutedTests > 0) {
      console.error(
        `❌ 未実行のテストがあります: ${report.summary.notExecutedTests}個`,
      );
      isValid = false;
    }

    // 最近の失敗チェック（1時間以内）
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    const recentFailures = report.qualityMetrics.mostRecentFailures.filter(
      (failure) => new Date(failure.timestamp).getTime() > oneHourAgo,
    );

    if (recentFailures.length > 0) {
      console.error(
        `❌ 過去1時間以内にテスト失敗があります: ${recentFailures.length}個`,
      );
      isValid = false;
    }

    // 必須テスト種別チェック
    const hasRecentIntegration = report.testsByType.integration.some(
      (test) => test.success && new Date(test.timestamp).getTime() > oneHourAgo,
    );
    const hasRecentE2E = report.testsByType.e2e.some(
      (test) => test.success && new Date(test.timestamp).getTime() > oneHourAgo,
    );

    if (!hasRecentIntegration) {
      console.error("❌ 過去1時間以内の統合テスト成功記録がありません");
      isValid = false;
    }

    if (!hasRecentE2E) {
      console.error("❌ 過去1時間以内のE2Eテスト成功記録がありません");
      isValid = false;
    }

    if (isValid) {
      console.log("✅ テスト品質検証に合格しました");
    }

    return isValid;
  }
}

/**
 * メイン実行関数
 */
export default function testExecutionDashboard(): void {
  const dashboard = new TestExecutionDashboard();

  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case "report":
      dashboard.displayReport();
      break;

    case "validate":
      const isValid = dashboard.validateQuality();
      process.exit(isValid ? 0 : 1);
      break;

    case "generate":
      const report = dashboard.generateReport();
      console.log("📊 ダッシュボードレポートを生成しました:");
      console.log(`.claude/test-dashboard-report.json`);
      break;

    default:
      console.log("使用方法:");
      console.log("  npx tsx .claude/test-execution-dashboard.ts report");
      console.log("  npx tsx .claude/test-execution-dashboard.ts validate");
      console.log("  npx tsx .claude/test-execution-dashboard.ts generate");
      process.exit(1);
  }
}

// スクリプトとして実行された場合
if (import.meta.url === `file://${process.argv[1]}`) {
  testExecutionDashboard();
}
