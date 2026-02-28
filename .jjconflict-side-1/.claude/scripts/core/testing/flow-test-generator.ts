#!/usr/bin/env npx tsx
/**
 * メイン自動フロー追跡・テスト生成システム
 *
 * 目的: Git変更を検出し、影響フローを特定して
 *      エンドツーエンドテストを自動生成・実行する
 *
 * 使用方法:
 *   npx tsx .claude/auto-flow-test-system.ts --analyze-current
 *   npx tsx .claude/auto-flow-test-system.ts --analyze-staged
 *   npx tsx .claude/auto-flow-test-system.ts --generate-tests
 *   npx tsx .claude/auto-flow-test-system.ts --full-analysis
 */

import * as fs from "fs";
import * as path from "path";
import { GitChangeAnalyzer } from "../git/change-analyzer";
import { FlowDetectorService } from "../../../../src/services/flow-detector-service";
import { DetectionOutputManager } from "../../lib/flow-analysis/detection-output-manager";
import { SystemConfig } from "../../../../src/types/hooks/auto-flow-test-system";
import { logHookMessage } from "../../../../src/lib/utils/hook-utils";

/**
 * 自動フロー追跡・テスト生成システムのメインクラス
 *
 * @class AutoFlowTestSystem
 * @description Git変更を検出し、影響フローを特定して自動的にテストを生成するシステム
 *
 * @example
 * ```typescript
 * const system = new AutoFlowTestSystem('/path/to/project');
 * await system.analyzeCurrentChanges();
 * ```
 */
class AutoFlowTestSystem {
  private gitAnalyzer: GitChangeAnalyzer;
  private flowDetector: FlowDetectorService;
  private testGenerator: TestGenerator;
  private detectionOutput: DetectionOutputManager;
  private config: SystemConfig;

  /**
   * AutoFlowTestSystemコンストラクタ
   *
   * @param projectRoot プロジェクトルートディレクトリパス（デフォルト: 現在のワーキングディレクトリ）
   *
   * @description
   * - システム設定の初期化
   * - 必要なコンポーネントのインスタンス作成
   * - ディレクトリ構造の確保
   *
   * @example
   * ```typescript
   * const system = new AutoFlowTestSystem('/path/to/project');
   * await system.analyzeCurrentChanges();
   * ```
   */
  constructor(projectRoot: string = process.cwd()) {
    this.config = {
      projectRoot,
      outputDir: path.join(projectRoot, "tests", "generated"),
      logFile: path.join(projectRoot, ".claude", "flow-analysis.log"),
      enabledFeatures: {
        flowDetection: true,
        testGeneration: true,
        autoExecution: false, // 初期は無効
      },
    };

    this.gitAnalyzer = new GitChangeAnalyzer(projectRoot);
    this.flowDetector = new FlowDetectorService(projectRoot);
    this.testGenerator = new TestGenerator(projectRoot);
    this.detectionOutput = new DetectionOutputManager(projectRoot);

    this.ensureDirectories();
  }

  /**
   * 現在の変更を分析してテスト生成
   *
   * @returns Promise<void>
   *
   * @description
   * Gitのワーキングディレクトリとインデックスの変更を検出し、
   * 影響するフローを特定して自動テストを生成します。
   *
   * @throws {Error} Git操作やファイルアクセスエラー時
   *
   * @example
   * ```typescript
   * const system = new AutoFlowTestSystem();
   * await system.analyzeCurrentChanges();
   * ```
   */
  async analyzeCurrentChanges(): Promise<void> {
    console.log("🔍 現在の変更分析を開始...");
    this.log("=== 現在の変更分析開始 ===");

    try {
      // 1. Git変更の検出
      const changeContext = this.gitAnalyzer.detectCurrentChanges();
      this.log(`変更ファイル数: ${changeContext.changes.length}`);

      if (changeContext.changes.length === 0) {
        console.log("ℹ️ 変更されたファイルはありません。");
        return;
      }

      // 2. 変更レポートの生成
      const changeReport = this.gitAnalyzer.generateChangeReport(changeContext);
      console.log(changeReport);
      this.log(changeReport);

      // 3. 影響分析の実行
      await this.performImpactAnalysis(changeContext);
    } catch (error) {
      console.error("❌ 分析中にエラーが発生:", error);
      this.log(`エラー: ${error}`);
      throw error;
    }
  }

  /**
   * ステージされた変更を分析してテスト生成
   *
   * @returns Promise<void>
   *
   * @description
   * Gitインデックスにステージされた変更のみを対象として、
   * 影響するフローを特定して自動テストを生成します。
   * コミット前の確認に適しています。
   *
   * @throws {Error} Git操作やファイルアクセスエラー時
   *
   * @example
   * ```typescript
   * // git add 後に実行
   * const system = new AutoFlowTestSystem();
   * await system.analyzeStagedChanges();
   * ```
   */
  async analyzeStagedChanges(): Promise<void> {
    console.log("🔍 ステージされた変更を分析...");
    this.log("=== ステージ変更分析開始 ===");

    try {
      const changeContext = this.gitAnalyzer.detectStagedChanges();
      this.log(`ステージファイル数: ${changeContext.changes.length}`);

      if (changeContext.changes.length === 0) {
        console.log("ℹ️ ステージされたファイルはありません。");
        return;
      }

      const changeReport = this.gitAnalyzer.generateChangeReport(changeContext);
      console.log(changeReport);
      this.log(changeReport);

      await this.performImpactAnalysis(changeContext);
    } catch (error) {
      console.error("❌ ステージ分析中にエラーが発生:", error);
      this.log(`エラー: ${error}`);
      throw error;
    }
  }

  /**
   * 影響分析の実行
   *
   * @param changeContext Git変更コンテキスト
   * @returns Promise<void>
   *
   * @description
   * 変更されたファイルを基に影響するフローを特定し、
   * 環境依存パターンや高リスク変更を検出してテストを生成します。
   *
   * @private
   */
  private async performImpactAnalysis(changeContext: any): Promise<void> {
    console.log("📊 影響分析を実行中...");

    // フロー検出システムの初期化
    if (this.config.enabledFeatures.flowDetection) {
      await this.flowDetector.detectAllFlows();
    }

    // 変更影響分析
    const analysis = await this.gitAnalyzer.analyzeChangeImpact(changeContext);

    // 分析レポートの生成
    const analysisReport = this.flowDetector.generateAnalysisReport(analysis);
    console.log(analysisReport);
    this.log(analysisReport);

    // パターン検知とAI用検知結果出力
    const changedFilesArray = Array.isArray(changeContext.changedFiles)
      ? changeContext.changedFiles
      : [changeContext.changedFiles].filter(Boolean);
    await this.detectPatternsAndOutput(changedFilesArray, analysis);

    // テスト生成の実行
    if (
      this.config.enabledFeatures.testGeneration &&
      analysis.affectedFlows.length > 0
    ) {
      await this.generateAndSaveTests(analysis);
    } else if (analysis.affectedFlows.length === 0) {
      console.log(
        "ℹ️ 影響を受ける処理フローがありません。テスト生成をスキップします。",
      );
    }
  }

  /**
   * テスト生成と保存
   *
   * @param analysis 影響分析結果
   * @returns Promise<void>
   *
   * @description
   * 影響分析結果を基に具体的なテストコードを生成し、
   * 指定されたディレクトリに保存します。
   *
   * @private
   */
  private async generateAndSaveTests(analysis: any): Promise<void> {
    console.log("🧪 エンドツーエンドテスト生成中...");

    try {
      // テストの生成
      const tests = this.testGenerator.generateTests(analysis);

      if (tests.length > 0) {
        // テストファイルの保存
        this.testGenerator.saveTests(tests);

        // レポートの生成
        const testReport = this.testGenerator.generateTestReport(tests);
        console.log(testReport);
        this.log(testReport);

        // テスト実行（有効な場合）
        if (this.config.enabledFeatures.autoExecution) {
          await this.executeGeneratedTests(tests);
        } else {
          console.log("💡 テストを手動実行する場合:");
          console.log("   npm run test:vitest -- tests/generated/");
        }
      } else {
        console.log("ℹ️ 生成されたテストはありません。");
      }
    } catch (error) {
      console.error("❌ テスト生成中にエラーが発生:", error);
      this.log(`テスト生成エラー: ${error}`);
      throw error;
    }
  }

  /**
   * 生成されたテストの実行
   *
   * @param tests 生成されたテストの配列
   * @returns Promise<void>
   *
   * @description
   * 生成されたテストファイルを実行し、結果をコンソールに表示します。
   * 自動実行機能が有効な場合のみ動作します。
   *
   * @private
   */
  private async executeGeneratedTests(tests: any[]): Promise<void> {
    console.log("🚀 生成されたテストを実行中...");

    const { execSync } = await import("child_process");

    try {
      const testFiles = tests.map((test) => test.filePath).join(" ");
      const result = execSync(`npm run test:vitest -- ${testFiles}`, {
        cwd: this.config.projectRoot,
        encoding: "utf-8",
        stdio: "pipe",
      });

      console.log("✅ テスト実行完了:");
      console.log(result);
      this.log(`テスト実行結果:\n${result}`);
    } catch (error) {
      console.error("❌ テスト実行中にエラーが発生:", error);
      this.log(`テスト実行エラー: ${error}`);
      // テスト実行の失敗は致命的ではない
    }
  }

  /**
   * 完全分析（推奨モード）
   *
   * @returns Promise<void>
   *
   * @description
   * 全ての分析機能を組み合わせた最も包括的な分析モードです。
   * フロー検出、影響分析、テスト生成を順次実行します。
   *
   * @throws {Error} いずれかの分析ステップでエラーが発生した場合
   *
   * @example
   * ```typescript
   * const system = new AutoFlowTestSystem();
   * await system.fullAnalysis(); // 推奨の使用方法
   * ```
   */
  async fullAnalysis(): Promise<void> {
    console.log("🎯 完全分析モードを開始...");
    this.log("=== 完全分析開始 ===");

    try {
      // 1. プロジェクト全体のフロー分析
      console.log("📡 プロジェクト全体のフロー分析...");
      await this.flowDetector.detectAllFlows(true); // 強制更新

      // 2. 現在の変更分析
      await this.analyzeCurrentChanges();

      console.log("🎉 完全分析が完了しました。");
    } catch (error) {
      console.error("❌ 完全分析中にエラーが発生:", error);
      this.log(`完全分析エラー: ${error}`);
      throw error;
    }
  }

  /**
   * 必要なディレクトリの作成
   *
   * @returns void
   *
   * @description
   * テスト出力ディレクトリやログディレクトリなど、
   * システム動作に必要なディレクトリを作成します。
   *
   * @private
   */
  private ensureDirectories(): void {
    const dirs = [this.config.outputDir, path.dirname(this.config.logFile)];

    for (const dir of dirs) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
  }

  /**
   * ログ出力
   *
   * @param message ログメッセージ
   * @returns void
   *
   * @description
   * 共通ログユーティリティを使用してメッセージをログファイルに記録します。
   * システム固有のログファイルパスを使用します。
   *
   * @private
   */
  private log(message: string): void {
    logHookMessage(message, this.config.logFile);
  }

  /**
   * システム情報の表示
   *
   * @returns void
   *
   * @description
   * 現在のシステム設定、有効な機能、プロジェクト情報などを
   * コンソールに表示します。デバッグや設定確認に便利です。
   *
   * @example
   * ```typescript
   * const system = new AutoFlowTestSystem();
   * system.showSystemInfo();
   * ```
   */
  showSystemInfo(): void {
    console.log("🔧 自動フロー追跡システム情報");
    console.log("=".repeat(40));
    console.log(`📁 プロジェクトルート: ${this.config.projectRoot}`);
    console.log(`📄 出力ディレクトリ: ${this.config.outputDir}`);
    console.log(`📋 ログファイル: ${this.config.logFile}`);
    console.log(
      `⚙️  フロー検出: ${this.config.enabledFeatures.flowDetection ? "有効" : "無効"}`,
    );
    console.log(
      `🧪 テスト生成: ${this.config.enabledFeatures.testGeneration ? "有効" : "無効"}`,
    );
    console.log(
      `🚀 自動実行: ${this.config.enabledFeatures.autoExecution ? "有効" : "無効"}`,
    );
    console.log("");
  }

  /**
   * パターン検出と結果出力
   *
   * @param changedFiles 変更されたファイルパスの配列
   * @param analysis 影響分析結果
   * @returns Promise<void>
   *
   * @description
   * 変更されたファイルから環境依存パターンや高リスクパターンを検出し、
   * 検知結果を構造化して出力します。AI処理用データとして保存されます。
   *
   * @private
   */
  private async detectPatternsAndOutput(
    changedFiles: string[],
    analysis: any,
  ): Promise<void> {
    console.log("🔍 問題パターン検知を実行中...");

    for (const file of changedFiles) {
      const targetComponent = this.extractComponentName(file);

      // 環境依存問題パターンの検知
      const envPatterns = await this.detectEnvironmentDependencyPatterns(file);
      if (envPatterns.length > 0) {
        this.detectionOutput.outputEnvironmentDependencyDetection(
          [file],
          envPatterns,
          targetComponent,
          {
            issueId: this.inferIssueId(file, envPatterns),
            requirements: this.findRelatedRequirements(file),
            userStories: this.findRelatedUserStories(file),
            businessLogic: this.inferBusinessLogic(file, envPatterns),
          },
        );
        console.log(`🎯 環境依存問題を検知: ${file}`);
      }

      // 高リスク変更の検知
      if (
        analysis.impactScope === "high" ||
        analysis.impactScope === "critical"
      ) {
        this.detectionOutput.outputHighRiskDetection(
          [file],
          [
            `High impact scope: ${analysis.impactScope}`,
            `Affected flows: ${analysis.affectedFlows.length}`,
          ],
          targetComponent,
          {
            severity: analysis.impactScope === "critical" ? "critical" : "high",
            requirements: this.findRelatedRequirements(file),
            businessLogic: `High-risk changes detected in ${targetComponent}`,
          },
        );
        console.log(`⚠️ 高リスク変更を検知: ${file}`);
      }
    }
  }

  /**
   * 環境依存問題パターンの検知
   * 環境依存パターンの検出
   *
   * @param filePath 検出対象ファイルパス
   * @returns Promise<Array<{file: string; line: number; pattern: string}>>
   *
   * @description
   * 指定されたファイルからNODE_ENV等の環境依存コードパターンを検出します。
   * 運用環境と開発環境で動作が異なる可能性のあるコードを特定します。
   *
   * @example
   * ```typescript
   * const patterns = await detectEnvironmentDependencyPatterns('src/email.ts');
   * // => [{file: 'src/email.ts', line: 295, pattern: 'NODE_ENV === "production"'}]
   * ```
   *
   * @private
   */
  private async detectEnvironmentDependencyPatterns(
    filePath: string,
  ): Promise<Array<{ file: string; line: number; pattern: string }>> {
    const patterns: Array<{ file: string; line: number; pattern: string }> = [];

    try {
      const content = await import("fs").then((fs) =>
        fs.readFileSync(filePath, "utf-8"),
      );
      const lines = content.split("\n");

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // NODE_ENV条件分岐パターン
        if (
          line.includes("process.env.NODE_ENV") &&
          line.includes("===") &&
          line.includes("production")
        ) {
          patterns.push({
            file: filePath,
            line: i + 1,
            pattern: line.trim(),
          });
        }

        // 環境変数による分岐パターン
        if (
          line.includes("process.env") &&
          (line.includes("?") || line.includes("&&") || line.includes("||"))
        ) {
          patterns.push({
            file: filePath,
            line: i + 1,
            pattern: line.trim(),
          });
        }
      }
    } catch (error) {
      console.warn(`⚠️ ファイル読み込みエラー: ${filePath}`, error);
    }

    return patterns;
  }

  /**
   * ファイルパスからコンポーネント名を抽出
   *
   * @param filePath ファイルパス
   * @returns コンポーネント名（拡張子を除いたファイル名）
   *
   * @description
   * ファイルパスからファイル名を抽出し、拡張子を除去して
   * コンポーネント名として返します。
   *
   * @example
   * ```typescript
   * extractComponentName('src/components/Button.tsx'); // 'Button'
   * ```
   *
   * @private
   */
  private extractComponentName(filePath: string): string {
    const fileName = filePath.split("/").pop() || "";
    return fileName.replace(/\.(ts|tsx|js|jsx)$/, "");
  }

  /**
   * 関連要件ファイルの検索
   *
   * @param filePath 対象ファイルパス
   * @returns 関連要件ファイルパスの配列
   *
   * @description
   * ファイルパスとコンポーネント名から関連する要件文書を動的に検索します。
   * docs/management/requirements/active/ディレクトリをスキャンして、
   * ファイル名の部分一致で関連性を判定します。
   *
   * @example
   * ```typescript
   * findRelatedRequirements('src/workers/emailSender.ts');
   * // => ['docs/management/requirements/active/REQ-041_email_sender_fix.md']
   * ```
   *
   * @private
   */
  private findRelatedRequirements(filePath: string): string[] {
    const component = this.extractComponentName(filePath);
    const requirements: string[] = [];

    try {
      // docs/management/requirements/active/ ディレクトリをスキャン
      const requirementsDir = path.join(
        this.config.projectRoot,
        "docs/management/requirements/active",
      );
      if (fs.existsSync(requirementsDir)) {
        const files = fs
          .readdirSync(requirementsDir)
          .filter((f) => f.endsWith(".md"));

        for (const file of files) {
          const fileName = file.toLowerCase();
          const componentLower = component.toLowerCase();

          // ファイル名やコンポーネント名での部分一致検索
          if (
            (fileName.includes("email") &&
              (filePath.includes("email") ||
                componentLower.includes("email"))) ||
            (fileName.includes("worker") &&
              (filePath.includes("worker") ||
                componentLower.includes("worker"))) ||
            (fileName.includes("auth") &&
              (filePath.includes("auth") || componentLower.includes("auth")))
          ) {
            requirements.push(`docs/management/requirements/active/${file}`);
          }
        }
      }
    } catch (error) {
      console.warn("要件ファイル検索エラー:", error);
    }

    return requirements;
  }

  /**
   * 関連ユーザーストーリーの検索
   *
   * @param filePath 対象ファイルパス
   * @returns 関連ユーザーストーリーファイルパスの配列
   *
   * @description
   * ファイルパスとコンポーネント名から関連するユーザーストーリーを動的に検索します。
   * docs/management/user_stories/active/ディレクトリをスキャンして、
   * ファイル名の部分一致で関連性を判定します。
   *
   * @example
   * ```typescript
   * findRelatedUserStories('src/components/auth/LoginForm.tsx');
   * // => ['docs/management/user_stories/active/US-042_auth_improvement.md']
   * ```
   *
   * @private
   */
  private findRelatedUserStories(filePath: string): string[] {
    const component = this.extractComponentName(filePath);
    const userStories: string[] = [];

    try {
      // docs/management/user_stories/active/ ディレクトリをスキャン
      const userStoriesDir = path.join(
        this.config.projectRoot,
        "docs/management/user_stories/active",
      );
      if (fs.existsSync(userStoriesDir)) {
        const files = fs
          .readdirSync(userStoriesDir)
          .filter((f) => f.endsWith(".md"));

        for (const file of files) {
          const fileName = file.toLowerCase();
          const componentLower = component.toLowerCase();

          // ファイル名やコンポーネント名での部分一致検索
          if (
            (fileName.includes("email") &&
              (filePath.includes("email") ||
                componentLower.includes("email"))) ||
            (fileName.includes("worker") &&
              (filePath.includes("worker") ||
                componentLower.includes("worker"))) ||
            (fileName.includes("auth") &&
              (filePath.includes("auth") || componentLower.includes("auth")))
          ) {
            userStories.push(`docs/management/user_stories/active/${file}`);
          }
        }
      }
    } catch (error) {
      console.warn("ユーザーストーリー検索エラー:", error);
    }

    return userStories;
  }

  /**
   * Issue IDの推定
   *
   * @param filePath 対象ファイルパス
   * @param patterns 検出されたパターン配列
   * @returns Issue ID文字列（推定できない場合は空文字）
   *
   * @description
   * Gitブランチ名や変更パターンから現在のIssue IDを動的に推定します。
   * ブランチ名からタスクIDの抽出を試み、
   * 失敗した場合は自動生成IDを作成します。
   *
   * @example
   * ```typescript
   * // ブランチ: feature/BUG-005-fix-email
   * inferIssueId('src/email.ts', patterns); // 'BUG-005'
   * ```
   *
   * @private
   */
  private inferIssueId(filePath: string, patterns: any[]): string {
    try {
      // 現在のGitブランチ名からIssue IDを抽出
      const result = require("child_process").execSync(
        "git branch --show-current",
        { encoding: "utf8" },
      );
      const branchName = result.trim();

      // ブランチ名からタスクIDを抽出（例: feature/BUG-005-fix → BUG-005）
      const taskIdMatch = branchName.match(/([A-Z]+-\d+)/i);
      if (taskIdMatch) {
        return taskIdMatch[1];
      }

      // パターンベースの推定（汎用的）
      if (patterns.length > 0) {
        const component = this.extractComponentName(filePath);
        return `AUTO-${component.toUpperCase()}-${Date.now().toString().slice(-6)}`;
      }
    } catch (error) {
      console.warn("Issue ID推定エラー:", error);
    }

    return "";
  }

  /**
   * ビジネスロジックの推定
   *
   * @param filePath 対象ファイルパス
   * @param patterns 検出されたパターン配列
   * @returns ビジネスロジック説明文字列（日本語）
   *
   * @description
   * ファイルパスと検出パターンから関連するビジネスロジックを推定します。
   * メール関連、認証関連などのパターンに応じて
   * 適切なビジネスルールを返します。
   *
   * @example
   * ```typescript
   * inferBusinessLogic('src/email.ts', envPatterns);
   * // => 'メール配信は環境に関係なくユーザーのメールアドレスを使用する必要がある'
   * ```
   *
   * @private
   */
  private inferBusinessLogic(filePath: string, patterns: any[]): string {
    if (
      filePath.includes("email") &&
      patterns.some((p) => p.pattern.includes("NODE_ENV"))
    ) {
      return "メール配信は環境に関係なくユーザーのメールアドレスを使用する必要がある";
    }
    return "コードの動作は全環境で一貫している必要がある";
  }

  /**
   * システム設定の更新
   *
   * @param updates 更新する設定値（部分更新可能）
   * @returns void
   *
   * @description
   * 現在のシステム設定を指定された値で部分的に更新します。
   * 既存の設定は保持され、指定された項目のみが上書きされます。
   *
   * @example
   * ```typescript
   * system.updateConfig({
   *   enabledFeatures: { ...config.enabledFeatures, autoExecution: true }
   * });
   * ```
   */
  updateConfig(updates: Partial<SystemConfig>): void {
    this.config = { ...this.config, ...updates };
  }
}

/**
 * CLI インターフェース
 */
async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  const system = new AutoFlowTestSystem();

  try {
    switch (command) {
      case "--analyze-current":
        await system.analyzeCurrentChanges();
        break;

      case "--analyze-staged":
        await system.analyzeStagedChanges();
        break;

      case "--generate-tests":
        await system.fullAnalysis();
        break;

      case "--full-analysis":
        await system.fullAnalysis();
        break;

      case "--info":
        system.showSystemInfo();
        break;

      case "--help":
      default:
        console.log("🎯 自動フロー追跡・テスト生成システム");
        console.log("");
        console.log("使用方法:");
        console.log("  npx tsx .claude/auto-flow-test-system.ts [オプション]");
        console.log("");
        console.log("オプション:");
        console.log("  --analyze-current   現在の変更を分析");
        console.log("  --analyze-staged    ステージされた変更を分析");
        console.log("  --generate-tests    テスト生成（完全分析）");
        console.log("  --full-analysis     完全分析（推奨）");
        console.log("  --info             システム情報表示");
        console.log("  --help             このヘルプを表示");
        console.log("");
        console.log("例:");
        console.log(
          "  npx tsx .claude/auto-flow-test-system.ts --full-analysis",
        );
        break;
    }
  } catch (error) {
    console.error("💥 システムエラー:", error);
    process.exit(1);
  }
}

// スクリプトとして実行された場合
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { AutoFlowTestSystem };
