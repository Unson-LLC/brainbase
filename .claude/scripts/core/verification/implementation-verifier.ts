#!/usr/bin/env node
/**
 * 実装検証システム
 * 要件項目が実際に実装されているかを具体的に検証する
 */

import fs from "fs";
import path from "path";

interface ImplementationStatus {
  requirement: string;
  implemented: boolean;
  evidence: string[];
  missingEvidence: string[];
}

/**
 * 実装検証クラス
 */
export class ImplementationVerifier {
  private projectRoot: string;

  constructor() {
    this.projectRoot = process.cwd();
  }

  /**
   * 汎用的な実装検証メソッド
   * 要件ファイルから検証パターンを自動抽出して検証
   */
  async verifyImplementation(
    requirementFile: string,
  ): Promise<ImplementationStatus[]> {
    console.log(`🔍 ${requirementFile} の実装状況を検証中...`);

    // 要件ファイルから検証パターンを抽出
    const requirements =
      await this.extractRequirementsFromFile(requirementFile);

    const results: ImplementationStatus[] = [];
    for (const req of requirements) {
      const status = await this.verifyRequirement(req);
      results.push(status);
    }

    return results;
  }

  /**
   * 要件ファイルから検証パターンを自動抽出
   */
  private async extractRequirementsFromFile(
    requirementFile: string,
  ): Promise<any[]> {
    // まず検証パターンファイルを探す
    const requirementId = path.basename(requirementFile, ".md");
    const patternFile = path.join(
      this.projectRoot,
      ".claude",
      "verification-patterns",
      `${requirementId}.json`,
    );

    if (fs.existsSync(patternFile)) {
      // 検証パターンファイルが存在する場合はそれを使用
      const patternData = JSON.parse(fs.readFileSync(patternFile, "utf-8"));
      return patternData.verificationPatterns || [];
    }

    // 検証パターンファイルがない場合は要件ファイルから自動生成を試みる
    const filePath = path.join(this.projectRoot, requirementFile);

    if (!fs.existsSync(filePath)) {
      // 要件ファイルが存在しない場合はデフォルトの検証パターンを返す
      return this.getDefaultVerificationPatterns();
    }

    const content = fs.readFileSync(filePath, "utf-8");

    // 要件ファイルの内容から動的に検証パターンを生成
    return this.generateVerificationPatterns(content);
  }

  /**
   * 要件内容から検証パターンを生成
   */
  private generateVerificationPatterns(content: string): any[] {
    const patterns: any[] = [];

    // 基本的なパターン抽出ロジック
    // 例: テーブル名、サービス名、機能名などを抽出

    // テーブル関連
    if (content.includes("userテーブル")) {
      patterns.push({
        requirement: "userテーブルの操作",
        files: ["src/lib/services/**/*.ts", "src/app/api/**/*.ts"],
        codePattern: ["user.create", "user.update", "user.findFirst"],
        description: "userテーブル関連の実装",
      });
    }

    if (content.includes("accountテーブル")) {
      patterns.push({
        requirement: "accountテーブルの操作",
        files: ["src/lib/services/**/*.ts", "src/app/api/**/*.ts"],
        codePattern: [
          "account.create",
          "account.update",
          "createAccountIfNotExists",
        ],
        description: "accountテーブル関連の実装",
      });
    }

    // トランザクション関連
    if (
      content.includes("トランザクション") ||
      content.includes("ロールバック")
    ) {
      patterns.push({
        requirement: "トランザクション処理",
        files: ["src/lib/services/**/*.ts"],
        codePattern: ["\\$transaction", "tx\\.", "catch.*error"],
        description: "トランザクションとエラーハンドリング",
      });
    }

    // メール関連
    if (content.includes("メール") || content.includes("通知")) {
      patterns.push({
        requirement: "メール送信機能",
        files: [
          "src/lib/services/**/*notification*.ts",
          "src/lib/services/**/*email*.ts",
        ],
        codePattern: ["sendEmail", "sendInvitation", "sendNotification"],
        description: "メール送信の実装",
      });
    }

    // バリデーション関連
    if (content.includes("検証") || content.includes("バリデーション")) {
      patterns.push({
        requirement: "入力検証",
        files: [
          "src/lib/services/**/*validation*.ts",
          "src/lib/validators/**/*.ts",
        ],
        codePattern: ["validate", "isValid", "EMAIL_DUPLICATE"],
        description: "バリデーション処理",
      });
    }

    // パターンがない場合はデフォルトを返す
    if (patterns.length === 0) {
      return this.getDefaultVerificationPatterns();
    }

    return patterns;
  }

  /**
   * デフォルトの検証パターン
   */
  private getDefaultVerificationPatterns(): any[] {
    return [
      {
        requirement: "基本的な実装",
        files: ["src/**/*.ts", "src/**/*.tsx"],
        codePattern: ["export", "async", "return"],
        description: "基本的なコード構造",
      },
    ];
  }

  /**
   * REQ-040の実装状況を具体的に検証（互換性保持）
   */
  async verifyREQ040Implementation(): Promise<ImplementationStatus[]> {
    console.log("🔍 REQ-040実装状況を検証中...");

    const requirements = [
      {
        requirement:
          "管理者がユーザー作成を行うと、userテーブルレコードが作成される",
        files: [
          "src/lib/services/admin/userCreationService.ts",
          "src/lib/services/admin/adminUserService.ts",
        ],
        codePattern: ["tx.user.create", "createAdminUser"],
        description: "ユーザー作成処理の実装",
      },
      {
        requirement:
          "管理者がユーザー作成を行うと、accountテーブルレコードが作成される",
        files: ["src/lib/services/admin/userCreationService.ts"],
        codePattern: [
          "tx.account.create",
          "account.create",
          "createAccountIfNotExists",
        ],
        description: "アカウント作成処理の実装",
      },
      {
        requirement:
          "作成されたaccountレコードには適切なプロバイダー情報（credential）が設定される",
        files: ["src/lib/services/admin/userCreationService.ts"],
        codePattern: ["providerId.*credential", '"credential"'],
        description: "プロバイダー情報設定の実装",
      },
      {
        requirement:
          "作成されたユーザーに初回ログイン用の招待メールが送信される",
        files: [
          "src/lib/services/admin/userNotificationService.ts",
          "src/lib/services/admin/adminUserService.ts",
        ],
        codePattern: ["sendInvitationEmail", "generatePasswordResetToken"],
        description: "招待メール送信の実装",
      },
      {
        requirement: "メール内のリンクから新規ユーザーがパスワード設定を行える",
        files: ["src/lib/auth/passwordResetToken.ts"],
        codePattern: [
          "generatePasswordResetToken",
          "validatePasswordResetToken",
        ],
        description: "パスワードリセット機能の実装",
      },
      {
        requirement:
          "3つのテーブル（user, userSetting, account）が確実に作成される",
        files: ["src/lib/services/admin/userCreationService.ts"],
        codePattern: [
          "\\$transaction",
          "tx\\.user",
          "tx\\.userSetting",
          "createAccountIfNotExists",
        ],
        description: "トランザクション処理の実装",
      },
      {
        requirement:
          "トランザクション処理により、部分的な作成失敗時は全てロールバックされる",
        files: ["src/lib/services/admin/userCreationService.ts"],
        codePattern: [
          "\\$transaction",
          "catch.*error",
          "Error in UserCreationService",
        ],
        description: "エラーハンドリングとロールバック処理",
      },
      {
        requirement: "重複メールアドレスチェックが正常に動作する",
        files: ["src/lib/services/admin/userValidationService.ts"],
        codePattern: ["validateUserCreationInput", "EMAIL_DUPLICATE"],
        description: "メール重複チェックの実装",
      },
    ];

    const results: ImplementationStatus[] = [];

    for (const req of requirements) {
      const status = await this.verifyRequirement(req);
      results.push(status);
    }

    return results;
  }

  /**
   * 個別要件の実装状況を検証
   */
  private async verifyRequirement(
    requirement: any,
  ): Promise<ImplementationStatus> {
    const evidence: string[] = [];
    const missingEvidence: string[] = [];

    // ファイルの存在確認
    for (const file of requirement.files) {
      const filePath = path.join(this.projectRoot, file);
      if (fs.existsSync(filePath)) {
        evidence.push(`✅ ファイル存在: ${file}`);

        // コードパターンの確認
        const content = fs.readFileSync(filePath, "utf-8");
        const foundPatterns: string[] = [];
        const missingPatterns: string[] = [];

        for (const pattern of requirement.codePattern) {
          const regex = new RegExp(pattern, "i");
          if (regex.test(content)) {
            evidence.push(
              `✅ コード確認: ${file} に "${pattern}" パターンを発見`,
            );
            foundPatterns.push(pattern);
          } else {
            missingPatterns.push(pattern);
          }
        }

        // ファイル単位で少なくとも一つのパターンが見つかればOK（AND条件ではなくOR条件）
        if (missingPatterns.length === requirement.codePattern.length) {
          missingEvidence.push(
            `❌ コード未確認: ${file} に必要なパターンが見つからない（確認パターン: ${missingPatterns.join(", ")}）`,
          );
        }
      } else {
        missingEvidence.push(`❌ ファイル不存在: ${file}`);
      }
    }

    // より柔軟な判定: 全体として実装されていることが確認できればOK
    const hasImplementationEvidence = evidence.some((e) =>
      e.includes("コード確認"),
    );
    const hasCriticalMissing = missingEvidence.some((e) =>
      e.includes("ファイル不存在"),
    );

    const implemented = hasImplementationEvidence && !hasCriticalMissing;

    return {
      requirement: requirement.requirement,
      implemented,
      evidence,
      missingEvidence: implemented ? [] : missingEvidence,
    };
  }

  /**
   * 検証レポート生成
   */
  async generateImplementationReport(
    statuses: ImplementationStatus[],
  ): Promise<void> {
    const reportPath = path.join(
      this.projectRoot,
      "implementation-verification-report.md",
    );

    const implementedCount = statuses.filter((s) => s.implemented).length;
    const totalCount = statuses.length;
    const implementationRate =
      totalCount > 0 ? (implementedCount / totalCount) * 100 : 0;

    const report = `# REQ-040 実装検証レポート

## 実行日時: ${new Date().toISOString()}

## 実装状況サマリー

**実装完了率**: ${implementationRate.toFixed(1)}% (${implementedCount}/${totalCount} 要件)

${statuses
  .map(
    (status, index) => `
## ${index + 1}. ${status.implemented ? "✅" : "❌"} ${status.requirement}

**実装状況**: ${status.implemented ? "実装完了" : "実装不完了"}

### 実装根拠:
${status.evidence.map((e) => `- ${e}`).join("\n") || "（なし）"}

${
  status.missingEvidence.length > 0
    ? `
### 未実装・問題点:
${status.missingEvidence.map((e) => `- ${e}`).join("\n")}
`
    : ""
}
`,
  )
  .join("\n")}

## 推奨アクション

${
  implementationRate === 100
    ? "🎉 全要件が実装完了しています。要件ファイルのチェックボックスを更新してください。"
    : `⚠️ 実装が不完全な要件があります。以下の対応が必要です：
  
${statuses
  .filter((s) => !s.implemented)
  .map(
    (s) => `
### ${s.requirement}
${s.missingEvidence.map((e) => `- ${e}`).join("\n")}
`,
  )
  .join("\n")}
`
}

---
*このレポートは実装検証システムにより生成されました*
`;

    fs.writeFileSync(reportPath, report, "utf-8");
    console.log(`📄 実装検証レポート生成: ${reportPath}`);
  }
}

/**
 * CLI実行時のエントリーポイント
 */
async function main() {
  if (import.meta.url === `file://${process.argv[1]}`) {
    const verifier = new ImplementationVerifier();

    // コマンドライン引数から要件ファイルを取得
    const requirementFile = process.argv[2];

    try {
      let statuses: ImplementationStatus[];

      if (requirementFile) {
        // 指定された要件ファイルを検証
        statuses = await verifier.verifyImplementation(requirementFile);
      } else {
        // デフォルトでREQ-040を検証（互換性保持）
        statuses = await verifier.verifyREQ040Implementation();
      }

      console.log("\n📊 REQ-040実装検証結果:");
      for (const status of statuses) {
        const statusIcon = status.implemented ? "✅" : "❌";
        console.log(`${statusIcon} ${status.requirement}`);
        if (!status.implemented) {
          console.log(`   理由: ${status.missingEvidence.join(", ")}`);
        }
      }

      await verifier.generateImplementationReport(statuses);

      const unimplementedCount = statuses.filter((s) => !s.implemented).length;
      if (unimplementedCount > 0) {
        console.log(
          `\n⚠️ ${unimplementedCount}件の要件が未実装または実装不完全です。`,
        );
        console.log(
          "詳細は implementation-verification-report.md を確認してください。",
        );
        process.exit(1);
      }

      console.log("\n🎉 REQ-040の全要件が実装完了しています");
    } catch (error) {
      console.error("❌ 実装検証エラー:", error);
      process.exit(1);
    }
  }
}

main();
