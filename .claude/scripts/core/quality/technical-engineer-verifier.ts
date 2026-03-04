/**
 * 技術者思考強制システム
 *
 * AIを「作業者」から「技術者」に100%強制変更
 * 1. 技術的影響分析の強制
 * 2. 動作確認の強制
 * 3. 「なぜ」思考の強制
 * 4. 完了基準の厳格化
 */

import * as fs from "fs";
import * as path from "path";

import type {
  TechnicalAnalysis,
  OperationContext,
} from "../../../../src/types/claude-hooks";

/**
 * 技術者が必ず分析すべき項目
 */
const MANDATORY_TECHNICAL_ANALYSIS = {
  deletion: [
    "このファイル/設定の技術的役割は何か？",
    "削除したらどのシステムが影響を受けるか？",
    "依存関係はどこにあるか？",
    "削除以外の解決方法はないか？",
    "バックアップや復旧方法は？",
  ],
  modification: [
    "変更の技術的妥当性は？",
    "既存機能への影響は？",
    "変更後のテスト方法は？",
    "ロールバック方法は？",
  ],
  ui_change: [
    "変更が正しく反映されているか？",
    "ブラウザで実際に確認したか？",
    "期待通りの表示になっているか？",
    "キャッシュクリアが必要か？",
  ],
  system_file: [
    "このファイルがシステムに与える影響は？",
    "他の機能との連携は？",
    "設定変更の波及効果は？",
    "システム全体への影響は？",
  ],
};

/**
 * 動作確認が必須の操作
 */
const VERIFICATION_REQUIRED_OPERATIONS = [
  // UI変更
  {
    pattern: /\.(tsx|jsx|vue|html|css|scss)$/,
    verification: "ブラウザでの実際の表示確認",
  },
  {
    pattern: /components\/.*\.(tsx|jsx)$/,
    verification: "コンポーネントの動作確認",
  },

  // 設定ファイル
  {
    pattern: /\.(json|yaml|yml|env|config)$/,
    verification: "アプリケーション動作確認",
  },
  { pattern: /package\.json$/, verification: "依存関係とビルド確認" },

  // データベース
  { pattern: /prisma\/.*$/, verification: "データベース接続と動作確認" },
  { pattern: /migrations\/.*$/, verification: "マイグレーション実行確認" },

  // Hook・システムファイル
  { pattern: /\.claude\/.*$/, verification: "Hookシステム動作確認" },
];

/**
 * 技術者思考強制クラス
 */
export class TechnicalEngineerVerifier {
  /**
   * 操作の文脈を解析
   */
  private analyzeOperationContext(toolInput: string): OperationContext {
    const commandMatch = toolInput.match(/"command"\s*:\s*"([^"]+)"/);
    const filePathMatch = toolInput.match(/"file_path"\s*:\s*"([^"]+)"/);

    const command = commandMatch ? commandMatch[1] : "";
    const filePath = filePathMatch ? filePathMatch[1] : "";

    return {
      tool: this.getTool(toolInput),
      action: command,
      target: filePath,
      isModification:
        toolInput.includes("Edit") || toolInput.includes("MultiEdit"),
      isDeletion: command.includes("rm ") || command.includes("delete"),
      isSystemFile:
        filePath.includes(".claude/") ||
        filePath.includes("prisma/") ||
        filePath.includes("package.json"),
      isUIChange: /\.(tsx|jsx|vue|html|css|scss)$/.test(filePath),
    };
  }

  /**
   * ツール名を取得
   */
  private getTool(toolInput: string): string {
    if (toolInput.includes("Edit")) return "Edit";
    if (toolInput.includes("Write")) return "Write";
    if (toolInput.includes("MultiEdit")) return "MultiEdit";
    if (toolInput.includes("Bash")) return "Bash";
    return "Unknown";
  }

  /**
   * 技術的分析を強制
   */
  private enforceTechnicalAnalysis(
    context: OperationContext,
  ): TechnicalAnalysis {
    const mandatoryQuestions: string[] = [];
    const requiredAnalysis: string[] = [];
    const postActionVerification: string[] = [];

    // 削除操作の分析
    if (context.isDeletion) {
      mandatoryQuestions.push(...MANDATORY_TECHNICAL_ANALYSIS.deletion);
      requiredAnalysis.push("削除の技術的妥当性を分析してください");

      // システムファイル削除は特に厳格
      if (context.isSystemFile) {
        return {
          canProceed: false,
          blockReason: "システムファイルの削除には特別な分析が必要です",
          mandatoryQuestions: [
            "なぜこのシステムファイルを削除する必要があるのですか？",
            "システム全体への影響を完全に把握していますか？",
            "代替方法を検討しましたか？",
            "この削除が本当に技術的に正しい判断ですか？",
          ],
          requiredAnalysis: ["システム影響の完全分析"],
          postActionVerification: [],
        };
      }
    }

    // 変更操作の分析
    if (context.isModification) {
      mandatoryQuestions.push(...MANDATORY_TECHNICAL_ANALYSIS.modification);
      requiredAnalysis.push("変更の技術的影響を分析してください");
    }

    // UI変更の動作確認
    if (context.isUIChange) {
      mandatoryQuestions.push(...MANDATORY_TECHNICAL_ANALYSIS.ui_change);
      postActionVerification.push("ブラウザでの実際の表示確認");
      postActionVerification.push("期待通りの動作になっているか確認");
      postActionVerification.push("動作しない場合は原因調査と再修正");
    }

    // システムファイルの分析
    if (context.isSystemFile) {
      mandatoryQuestions.push(...MANDATORY_TECHNICAL_ANALYSIS.system_file);
      requiredAnalysis.push("システム全体への影響分析");
    }

    // 動作確認の追加
    for (const { pattern, verification } of VERIFICATION_REQUIRED_OPERATIONS) {
      if (context.target && pattern.test(context.target)) {
        postActionVerification.push(verification);
      }
    }

    return {
      canProceed: true,
      mandatoryQuestions,
      requiredAnalysis,
      postActionVerification,
    };
  }

  /**
   * 技術者思考の強制表示
   */
  private displayTechnicalRequirements(
    analysis: TechnicalAnalysis,
    context: OperationContext,
  ): void {
    console.log("🔧 技術者思考強制システム");
    console.log("━".repeat(70));

    if (!analysis.canProceed) {
      console.log(`❌ ブロック理由: ${analysis.blockReason}`);
      console.log("");
    }

    if (analysis.mandatoryQuestions.length > 0) {
      console.log("❓ 技術者として必ず考えるべき質問:");
      analysis.mandatoryQuestions.forEach((q, i) => {
        console.log(`   ${i + 1}. ${q}`);
      });
      console.log("");
    }

    if (analysis.requiredAnalysis.length > 0) {
      console.log("🔍 実行前に必須の技術分析:");
      analysis.requiredAnalysis.forEach((a, i) => {
        console.log(`   ${i + 1}. ${a}`);
      });
      console.log("");
    }

    if (analysis.postActionVerification.length > 0) {
      console.log("✅ 実行後に必須の動作確認:");
      analysis.postActionVerification.forEach((v, i) => {
        console.log(`   ${i + 1}. ${v}`);
      });
      console.log("");
    }

    console.log("📋 技術者の責任:");
    console.log("   - 「作業完了」ではなく「動作確認完了」まで");
    console.log("   - 推測ではなく技術的根拠に基づく判断");
    console.log("   - 影響分析なしの実行は禁止");
    console.log("   - 動作しない場合は原因究明まで継続");
    console.log("");

    if (!analysis.canProceed) {
      console.log("🚨 上記の技術分析を完了してから再実行してください");
      console.log("━".repeat(70));
      process.exit(1);
    } else {
      console.log("⚠️  上記の技術者責任を完全に理解して実行してください");
      console.log("━".repeat(70));
    }
  }

  /**
   * ログ記録
   */
  private logTechnicalThinking(
    context: OperationContext,
    analysis: TechnicalAnalysis,
  ): void {
    const logEntry = {
      timestamp: new Date().toISOString(),
      tool: context.tool,
      action: context.action,
      target: context.target,
      isSystemFile: context.isSystemFile,
      isUIChange: context.isUIChange,
      questionsCount: analysis.mandatoryQuestions.length,
      analysisCount: analysis.requiredAnalysis.length,
      verificationCount: analysis.postActionVerification.length,
      blocked: !analysis.canProceed,
    };

    const logPath = ".claude/output/logs/technical-engineer.log";
    try {
      fs.appendFileSync(logPath, JSON.stringify(logEntry) + "\n");
    } catch {
      // ログ失敗しても継続
    }
  }

  /**
   * メイン検証実行
   */
  public verify(toolInput: string): void {
    if (!toolInput) return;

    const context = this.analyzeOperationContext(toolInput);
    const analysis = this.enforceTechnicalAnalysis(context);

    // 技術者思考が必要な場合のみ表示
    if (
      analysis.mandatoryQuestions.length > 0 ||
      analysis.requiredAnalysis.length > 0 ||
      analysis.postActionVerification.length > 0 ||
      !analysis.canProceed
    ) {
      this.displayTechnicalRequirements(analysis, context);
      this.logTechnicalThinking(context, analysis);
    }
  }
}
