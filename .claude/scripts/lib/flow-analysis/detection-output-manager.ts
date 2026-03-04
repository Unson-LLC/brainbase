/**
 * 検知結果出力管理システム
 *
 * @description フック検知結果を構造化して人工知能処理用に出力する管理システム
 * @purpose 機械的検知結果を人工知能が理解しやすい形式で構造化・保存
 * @author Claude 人工知能アシスタント
 * @since 2025-09-20
 *
 * @example
 * ```typescript
 * const manager = new DetectionOutputManager();
 *
 * // 環境依存問題を検知・出力
 * manager.outputEnvironmentDependencyDetection(
 *   ["src/workers/emailSender.ts"],
 *   patterns,
 *   "emailSender",
 *   { issueId: "ENV-001", businessLogic: "メール送信機能は環境に依存しない動作が必要" }
 * );
 * ```
 */

import * as fs from "fs";
import * as path from "path";
import { DetectionOutput } from "../../../../src/types/hooks/detection-output";
import {
  generateHookTimestamp,
  ensureHookDirectories,
} from "../../../../src/lib/utils/hook-utils";

/**
 * 検知結果出力管理クラス
 *
 * @description Hook検知結果をAI処理向けに構造化・保存するメインクラス
 * @purpose 機械的検知とAI生成テストの橋渡し役として機能
 *
 * @features
 * - 環境依存問題の検知・出力
 * - 高リスク変更の検知・出力
 * - 汎用パターン検知・出力
 * - 検知結果のライフサイクル管理（active → processed → archived）
 * - AI向けテストガイダンスの自動生成
 *
 * @architecture
 * ```
 * .claude/detections/
 * ├── active/     # AI処理待ちの検知結果
 * ├── processed/  # テスト生成完了済み
 * └── archived/   # 自動アーカイブ（7日後）
 * ```
 */
export class DetectionOutputManager {
  /** 検知結果ルートディレクトリ */
  private detectionsDir: string;

  /** アクティブ検知結果ディレクトリ（AI処理待ち） */
  private activeDir: string;

  /** 処理済み検知結果ディレクトリ */
  private processedDir: string;

  /** アーカイブディレクトリ */
  private archivedDir: string;

  /**
   * DetectionOutputManagerを初期化
   *
   * @param projectRoot プロジェクトルートディレクトリ（デフォルト: process.cwd()）
   *
   * @description
   * - 必要なディレクトリ構造を自動作成
   * - .claude/detections/ 配下にactive/processed/archived/を設置
   *
   * @example
   * ```typescript
   * const manager = new DetectionOutputManager('/path/to/project');
   * ```
   */
  constructor(projectRoot: string = process.cwd()) {
    this.detectionsDir = path.join(projectRoot, ".claude", "detections");
    this.activeDir = path.join(this.detectionsDir, "active");
    this.processedDir = path.join(this.detectionsDir, "processed");
    this.archivedDir = path.join(this.detectionsDir, "archived");

    // 共通ユーティリティを使用してディレクトリ構造を確保
    ensureHookDirectories(this.detectionsDir, [
      "active",
      "processed",
      "archived",
    ]);
  }

  /**
   * 環境依存問題パターン検知結果の出力
   *
   * @param changedFiles 変更されたファイルのパス配列
   * @param patterns 検知されたパターンの詳細配列
   * @param targetComponent 対象コンポーネント名
   * @param options 追加設定オプション
   * @param options.issueId 関連Issue ID
   * @param options.requirements 関連要件文書パス配列
   * @param options.userStories 関連ユーザーストーリーパス配列
   * @param options.businessLogic ビジネスロジック説明
   *
   * @returns 生成された検知結果ファイルのパス
   *
   * @description
   * NODE_ENV条件分岐などの環境依存問題を検知した際に、
   * AI処理用の構造化データとして出力します。
   *
   * @example
   * ```typescript
   * manager.outputEnvironmentDependencyDetection(
   *   ["src/workers/emailSender.ts"],
   *   [{ file: "src/workers/emailSender.ts", line: 295, pattern: "NODE_ENV === 'production'" }],
   *   "emailSender",
   *   {
   *     issueId: "BUG-005-fix-immediate-send-email-address",
   *     businessLogic: "メール配信は環境に関係なくユーザーのメールアドレスを使用する必要がある"
   *   }
   * );
   * ```
   */
  outputEnvironmentDependencyDetection(
    changedFiles: string[],
    patterns: Array<{ file: string; line: number; pattern: string }>,
    targetComponent: string,
    options: {
      issueId?: string;
      requirements?: string[];
      userStories?: string[];
      businessLogic?: string;
    } = {},
  ): string {
    const timestamp = generateHookTimestamp();
    const fileName = `ENV-DEPENDENCY_${targetComponent}_${timestamp}.json`;

    const output: DetectionOutput = {
      metadata: {
        trigger: "ENV-DEPENDENCY",
        timestamp: new Date().toISOString(),
        targetComponent,
        confidence: "high",
      },

      detection: {
        changedFiles,
        detectedPatterns: patterns.map((p) => ({
          type: "environment_conditional_override",
          location: p,
          severity: "critical" as const,
        })),
        riskAssessment: {
          level: "critical",
          reasons: [
            "環境依存の条件分岐ロジックを検出",
            "開発環境と本番環境で動作が異なる可能性",
            "実行時の一貫性に問題のある可能性",
          ],
        },
      },

      context: {
        requirements: options.requirements || [],
        userStories: options.userStories || [],
        relatedIssues: options.issueId ? [options.issueId] : [],
        businessLogic:
          options.businessLogic ||
          "コードの動作は全環境で一貫している必要がある",
      },

      testGuidance: {
        priority: "critical",
        suggestedTestTypes: ["unit", "regression"],
        focusAreas: [
          "環境非依存性の検証",
          "条件分岐ロジックの妥当性確認",
          "環境横断での動作一貫性確認",
        ],
        antiPatterns: [
          "単一環境シナリオのみのテスト",
          "条件分岐のエッジケース無視",
          "ビジネスコンテキストなしの汎用アサーション",
        ],
      },
    };

    return this.saveDetection(fileName, output);
  }

  /**
   * 高リスク変更検知結果の出力
   *
   * @param changedFiles 変更されたファイルのパス配列
   * @param riskFactors リスク要因の説明配列
   * @param targetComponent 対象コンポーネント名
   * @param options 追加設定オプション
   * @param options.severity リスクレベル（デフォルト: "high"）
   * @param options.requirements 関連要件文書パス配列
   * @param options.userStories 関連ユーザーストーリーパス配列
   * @param options.businessLogic ビジネスロジック説明
   *
   * @returns 生成された検知結果ファイルのパス
   *
   * @description
   * 高い影響度を持つコード変更を検知した際に、
   * AI処理用の構造化データとして出力します。
   *
   * @example
   * ```typescript
   * manager.outputHighRiskDetection(
   *   ["src/services/paymentProcessor.ts"],
   *   ["Database transaction logic modified", "Critical business logic changed"],
   *   "paymentProcessor",
   *   { severity: "critical", businessLogic: "決済処理には広範囲なテストが必要" }
   * );
   * ```
   */
  outputHighRiskDetection(
    changedFiles: string[],
    riskFactors: string[],
    targetComponent: string,
    options: {
      severity?: "critical" | "high" | "medium" | "low";
      requirements?: string[];
      userStories?: string[];
      businessLogic?: string;
    } = {},
  ): string {
    const timestamp = generateHookTimestamp();
    const fileName = `HIGH-RISK_${targetComponent}_${timestamp}.json`;

    const output: DetectionOutput = {
      metadata: {
        trigger: "HIGH-RISK",
        timestamp: new Date().toISOString(),
        targetComponent,
        confidence: "medium",
      },

      detection: {
        changedFiles,
        detectedPatterns: riskFactors.map((factor) => ({
          type: "high_risk_change",
          location: { file: changedFiles[0], line: 0, pattern: factor },
          severity: options.severity || ("high" as const),
        })),
        riskAssessment: {
          level: options.severity || "high",
          reasons: riskFactors,
        },
      },

      context: {
        requirements: options.requirements || [],
        userStories: options.userStories || [],
        relatedIssues: [],
        businessLogic:
          options.businessLogic ||
          "高リスクなコード変更を検出、徹底的なテストが必要",
      },

      testGuidance: {
        priority: options.severity || "high",
        suggestedTestTypes: ["integration", "e2e"],
        focusAreas: ["ビジネスロジック検証", "エラーハンドリング検証"],
        antiPatterns: ["最小限のテストカバレッジ", "エッジケースのスキップ"],
      },
    };

    return this.saveDetection(fileName, output);
  }

  /**
   * 汎用パターン検知結果の出力
   *
   * @param trigger 検知トリガータイプ
   * @param changedFiles 変更されたファイルのパス配列
   * @param patterns 検知されたパターンの詳細配列
   * @param targetComponent 対象コンポーネント名
   * @param options カスタマイズ可能な設定オプション
   *
   * @returns 生成された検知結果ファイルのパス
   *
   * @description
   * あらゆる種類のパターン検知に対応する汎用出力メソッド。
   * カスタムトリガーやパターンに対して柔軟に対応可能。
   *
   * @example
   * ```typescript
   * manager.outputGenericDetection(
   *   "SECURITY-ISSUE",
   *   ["src/auth/validator.ts"],
   *   [{ type: "sql_injection_risk", file: "src/auth/validator.ts", line: 42, pattern: "raw SQL query", severity: "critical" }],
   *   "authValidator",
   *   { priority: "critical", focusAreas: ["入力値検証", "SQLインジェクション防止"] }
   * );
   * ```
   */
  outputGenericDetection(
    trigger: DetectionOutput["metadata"]["trigger"],
    changedFiles: string[],
    patterns: Array<{
      type: string;
      file: string;
      line: number;
      pattern: string;
      severity: "critical" | "high" | "medium" | "low";
    }>,
    targetComponent: string,
    options: {
      confidence?: "high" | "medium" | "low";
      riskLevel?: "critical" | "high" | "medium" | "low";
      reasons?: string[];
      requirements?: string[];
      userStories?: string[];
      relatedIssues?: string[];
      businessLogic?: string;
      priority?: "critical" | "high" | "medium" | "low";
      suggestedTestTypes?: ("unit" | "integration" | "e2e" | "regression")[];
      focusAreas?: string[];
      antiPatterns?: string[];
    } = {},
  ): string {
    const timestamp = generateHookTimestamp();
    const fileName = `${trigger}_${targetComponent}_${timestamp}.json`;

    const output: DetectionOutput = {
      metadata: {
        trigger,
        timestamp: new Date().toISOString(),
        targetComponent,
        confidence: options.confidence || "medium",
      },

      detection: {
        changedFiles,
        detectedPatterns: patterns.map((p) => ({
          type: p.type,
          location: { file: p.file, line: p.line, pattern: p.pattern },
          severity: p.severity,
        })),
        riskAssessment: {
          level: options.riskLevel || "medium",
          reasons: options.reasons || ["注意が必要なパターンを検出"],
        },
      },

      context: {
        requirements: options.requirements || [],
        userStories: options.userStories || [],
        relatedIssues: options.relatedIssues || [],
        businessLogic:
          options.businessLogic || "検証が必要なコードパターンを検出",
      },

      testGuidance: {
        priority: options.priority || "medium",
        suggestedTestTypes: options.suggestedTestTypes || ["unit"],
        focusAreas: options.focusAreas || ["パターン検証"],
        antiPatterns: options.antiPatterns || [
          "コンテキストなしの汎用アサーション",
        ],
      },
    };

    return this.saveDetection(fileName, output);
  }

  /**
   * 検知結果の保存
   *
   * @param fileName 保存ファイル名
   * @param output 検知結果データ
   * @returns 保存されたファイルのフルパス
   *
   * @description
   * 検知結果をactive/ディレクトリにJSON形式で保存し、
   * AI処理待ち状態にします。
   *
   * @private
   */
  private saveDetection(fileName: string, output: DetectionOutput): string {
    const filePath = path.join(this.activeDir, fileName);

    try {
      fs.writeFileSync(filePath, JSON.stringify(output, null, 2), "utf-8");
      console.log(`🎯 検知結果を出力: ${fileName}`);
      return filePath;
    } catch (error) {
      console.error(`❌ 検知結果出力エラー: ${error}`);
      throw error;
    }
  }

  /**
   * 検知結果の処理済みマーク
   *
   * @param fileName 処理済みにするファイル名
   *
   * @description
   * active/からprocessed/にファイルを移動し、
   * AI処理完了をマークします。ファイル名に_PROCESSEDを追加。
   */
  markAsProcessed(fileName: string): void {
    const activePath = path.join(this.activeDir, fileName);
    const processedPath = path.join(
      this.processedDir,
      fileName.replace(".json", "_PROCESSED.json"),
    );

    if (fs.existsSync(activePath)) {
      fs.renameSync(activePath, processedPath);
      console.log(`✅ 検知結果を処理済みに移動: ${fileName}`);
    }
  }

  /**
   * アクティブな検知結果の一覧取得
   *
   * @returns AI処理待ちの検知結果ファイル名配列（新しいもの順）
   *
   * @description
   * active/ディレクトリから.jsonファイルを取得し、
   * タイムスタンプ順（新→古）でソートして返します。
   */
  getActiveDetections(): string[] {
    return fs
      .readdirSync(this.activeDir)
      .filter((file) => file.endsWith(".json"))
      .sort((a, b) => b.localeCompare(a)); // 新しいものから
  }

  /**
   * 検知結果の読み込み
   *
   * @param fileName 読み込むファイル名
   * @returns 検知結果データ（ファイルが存在しない場合はnull）
   *
   * @description
   * active/ディレクトリから指定ファイルを読み込み、
   * JSONをパースして検知結果オブジェクトとして返します。
   */
  readDetection(fileName: string): DetectionOutput | null {
    const filePath = path.join(this.activeDir, fileName);

    try {
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, "utf-8");
        return JSON.parse(content);
      }
      return null;
    } catch (error) {
      console.error(`❌ 検知結果読み込みエラー: ${error}`);
      return null;
    }
  }

  /**
   * 古い検知結果のアーカイブ
   *
   * @param daysOld アーカイブ対象とする日数（デフォルト: 7日）
   *
   * @description
   * 指定日数より古い処理済み検知結果を自動的にarchived/に移動します。
   * 日付別ディレクトリに整理して長期保存します。
   */
  archiveOldDetections(daysOld: number = 7): void {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);

    const processedFiles = fs.readdirSync(this.processedDir);

    for (const file of processedFiles) {
      const filePath = path.join(this.processedDir, file);
      const stats = fs.statSync(filePath);

      if (stats.mtime < cutoffDate) {
        const archiveDate = stats.mtime.toISOString().substring(0, 10);
        const archiveDateDir = path.join(this.archivedDir, archiveDate);

        if (!fs.existsSync(archiveDateDir)) {
          fs.mkdirSync(archiveDateDir, { recursive: true });
        }

        const archivePath = path.join(archiveDateDir, file);
        fs.renameSync(filePath, archivePath);
        console.log(`📦 検知結果をアーカイブ: ${file} → ${archiveDate}/`);
      }
    }
  }
}
