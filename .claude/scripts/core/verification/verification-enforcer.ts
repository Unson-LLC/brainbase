/**
 * 実証ベース検証強制システム
 *
 * 技術実装前に必ず具体的な事実確認アクションを強制するビジネスロジック
 * キーワード検出ではなく、実際の確認アクションの実行履歴を検証
 */

import * as fs from "fs";
import * as path from "path";

import type { VerificationRecord } from "../../../../src/types/claude-hooks";

// 技術実装前に必須の検証アクション
const REQUIRED_VERIFICATION_ACTIONS = {
  apiCall: "API エンドポイントの実際の呼び出しとレスポンス確認",
  codeRead: "関連ソースコードの実際の読み取り",
  typeCheck: "既存型定義の実際の確認",
  testExecution: "関連テストの実際の実行",
};

const VERIFICATION_LOG_PATH = ".claude/verification-evidence.json";

/**
 * 検証履歴管理クラス
 */
export class VerificationEnforcer {
  /**
   * 検証履歴を読み込む
   */
  private loadVerificationHistory(): VerificationRecord[] {
    try {
      if (fs.existsSync(VERIFICATION_LOG_PATH)) {
        const data = fs.readFileSync(VERIFICATION_LOG_PATH, "utf-8");
        return JSON.parse(data);
      }
    } catch (error) {
      console.warn("⚠️ 検証履歴の読み込みに失敗");
    }
    return [];
  }

  /**
   * 検証アクションをログに記録
   */
  public logVerificationAction(
    action: string,
    result: string,
    toolUsed: string,
  ): void {
    const record: VerificationRecord = {
      timestamp: new Date().toISOString(),
      action,
      result,
      toolUsed,
    };

    const history = this.loadVerificationHistory();
    history.push(record);

    // 過去24時間の記録のみ保持
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const filteredHistory = history.filter(
      (record) => record.timestamp > cutoff,
    );

    fs.mkdirSync(path.dirname(VERIFICATION_LOG_PATH), { recursive: true });
    fs.writeFileSync(
      VERIFICATION_LOG_PATH,
      JSON.stringify(filteredHistory, null, 2),
    );
  }

  /**
   * 指定期間内に検証が実行されたかチェック
   */
  private hasRecentVerification(
    requiredAction: string,
    withinMinutes: number = 30,
  ): boolean {
    const history = this.loadVerificationHistory();
    const cutoff = new Date(
      Date.now() - withinMinutes * 60 * 1000,
    ).toISOString();

    return history.some(
      (record) =>
        record.timestamp > cutoff &&
        (record.action.includes(requiredAction) ||
          record.action === requiredAction),
    );
  }

  /**
   * 検証証拠をチェック
   */
  private checkVerificationEvidence(
    input: string,
    toolName: string,
  ): {
    isVerified: boolean;
    missingActions: string[];
  } {
    const missingActions: string[] = [];

    // 技術実装ツールの検出
    const isTechnicalImplementation = ["Write", "Edit", "MultiEdit"].includes(
      toolName,
    );

    if (!isTechnicalImplementation) {
      return { isVerified: true, missingActions: [] };
    }

    // データ構造関連の実装検出
    const hasDataStructure =
      /interface|type|api|endpoint|response|data.*structure/i.test(input);

    if (hasDataStructure) {
      // 必須検証アクションの確認
      if (!this.hasRecentVerification("codeRead")) {
        missingActions.push(
          "関連ソースコードの実際の読み取り（SerenaのRead/FindSymbolツール使用）",
        );
      }

      if (!this.hasRecentVerification("apiCall")) {
        missingActions.push(
          "API エンドポイントの実際の呼び出し（curlまたはBashツール使用）",
        );
      }

      if (!this.hasRecentVerification("typeCheck")) {
        missingActions.push(
          "既存型定義の実際の確認（SerenaのFindSymbolツール使用）",
        );
      }
    }

    return {
      isVerified: missingActions.length === 0,
      missingActions,
    };
  }

  /**
   * メイン検証実行
   */
  public enforce(input: string, userPrompt: string, toolName: string): void {
    console.log("🔍 実証ベース検証を実行中...");

    // 検証証拠の自動記録（実行されたツールを記録）
    if (
      [
        "mcp__serena__find_symbol",
        "mcp__serena__read_file",
        "mcp__serena__get_symbols_overview",
      ].includes(toolName)
    ) {
      this.logVerificationAction("codeRead", `${toolName}実行完了`, toolName);
      console.log("📝 コード読み取り検証を記録しました");
    }

    if (toolName === "Bash" && input.includes("curl")) {
      this.logVerificationAction("apiCall", "API呼び出し実行完了", "Bash");
      console.log("📝 API呼び出し検証を記録しました");
    }

    if (toolName === "Bash" && input.includes("test")) {
      this.logVerificationAction("testExecution", "テスト実行完了", "Bash");
      console.log("📝 テスト実行検証を記録しました");
    }

    // 技術実装前の検証確認
    const verification = this.checkVerificationEvidence(
      input + " " + userPrompt,
      toolName,
    );

    if (!verification.isVerified) {
      console.error("❌ 必須の事実確認が未実行です");
      console.error("🔍 以下の具体的なアクションを実行してください：");
      console.error("");

      verification.missingActions.forEach((action, index) => {
        console.error(`${index + 1}. ${action}`);
      });

      console.error("");
      console.error(
        "🚫 推測による実装は禁止されています。具体的な確認アクションを実行してください。",
      );

      throw new Error(
        `必須の事実確認が未実行です: ${verification.missingActions.join(", ")}`,
      );
    }

    console.log("✅ 実証ベース検証をパスしました");
  }
}
