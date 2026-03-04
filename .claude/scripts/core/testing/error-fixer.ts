/**
 * AI自動テストエラー修正システム
 * テスト失敗を検知して自動修正を繰り返し実行
 */

import fs from "fs";
import { execSync } from "child_process";

interface TestError {
  file: string;
  errorType: string;
  errorMessage: string;
  stackTrace: string;
  lineNumber?: number;
  suggestion: string;
}

interface FixAttempt {
  attempt: number;
  timestamp: string;
  changes: string[];
  success: boolean;
  remainingErrors: TestError[];
}

class AutoTestErrorFixer {
  private maxAttempts = 5;
  private fixLog: FixAttempt[] = [];

  /**
   * テストエラーの分析と分類
   */
  private analyzeTestError(
    stderr: string,
    stdout: string,
    file: string,
  ): TestError[] {
    const errors: TestError[] = [];

    // Playwrightの場合、エラーはstdoutに出力される
    const errorText = stdout || stderr;

    // Prismaエラーの検出
    if (errorText.includes("Argument") && errorText.includes("is missing")) {
      const missingField = this.extractMissingField(errorText);
      errors.push({
        file,
        errorType: "PRISMA_MISSING_FIELD",
        errorMessage: `必須フィールド ${missingField} が未指定`,
        stackTrace: errorText,
        suggestion: `${missingField}フィールドを追加してください`,
      });
    }

    // Prisma null制約エラー
    if (
      errorText.includes("cannot be null") ||
      errorText.includes("field cannot be null") ||
      errorText.includes("must not be null")
    ) {
      errors.push({
        file,
        errorType: "PRISMA_MISSING_FIELD",
        errorMessage: "null制約違反エラー",
        stackTrace: errorText,
        suggestion: "必須フィールドにデフォルト値を設定してください",
      });
    }

    // Prismaテーブル存在エラー
    if (
      errorText.includes("Table") &&
      (errorText.includes("does not exist") ||
        errorText.includes("doesn't exist"))
    ) {
      errors.push({
        file,
        errorType: "PRISMA_MISSING_FIELD",
        errorMessage: "存在しないテーブル参照エラー",
        stackTrace: errorText,
        suggestion:
          "正しいテーブル名を使用してください（companyではなくgoldenCompany）",
      });
    }

    // TypeScriptエラーの検出
    if (errorText.includes("error TS")) {
      const tsError = this.extractTypeScriptError(errorText);
      errors.push({
        file,
        errorType: "TYPESCRIPT_ERROR",
        errorMessage: tsError.message,
        stackTrace: errorText,
        lineNumber: tsError.line,
        suggestion: tsError.suggestion,
      });
    }

    // インポートエラーの検出
    if (
      errorText.includes("Cannot find") ||
      errorText.includes("Module not found")
    ) {
      errors.push({
        file,
        errorType: "IMPORT_ERROR",
        errorMessage: "モジュールまたは型のインポートエラー",
        stackTrace: errorText,
        suggestion: "必要なインポートを追加してください",
      });
    }

    // テストタイムアウトエラー
    if (errorText.includes("timeout") || errorText.includes("Timeout")) {
      errors.push({
        file,
        errorType: "TEST_TIMEOUT",
        errorMessage: "テスト実行タイムアウト",
        stackTrace: errorText,
        suggestion:
          "waitForTimeout値を調整するか、テストロジックを簡素化してください",
      });
    }

    // データベース接続エラー
    if (
      errorText.includes("PrismaClient") &&
      errorText.includes("connection")
    ) {
      errors.push({
        file,
        errorType: "DATABASE_CONNECTION",
        errorMessage: "データベース接続エラー",
        stackTrace: errorText,
        suggestion: "PrismaClient初期化設定を確認してください",
      });
    }

    return errors;
  }

  /**
   * 不足フィールドの抽出
   */
  private extractMissingField(error: string): string {
    const match = error.match(/Argument `(\w+)` is missing/);
    return match ? match[1] : "unknown";
  }

  /**
   * TypeScriptエラーの詳細抽出
   */
  private extractTypeScriptError(error: string): {
    message: string;
    line?: number;
    suggestion: string;
  } {
    const tsMatch = error.match(/error TS(\d+): (.+)/);
    const lineMatch = error.match(/:(\d+):/);

    let suggestion = "型定義を確認してください";

    if (error.includes("Property") && error.includes("does not exist")) {
      suggestion = "プロパティ名または型定義を確認してください";
    } else if (error.includes("is missing")) {
      suggestion = "必須プロパティを追加してください";
    } else if (error.includes("Cannot find name")) {
      suggestion = "変数または関数の定義を確認してください";
    }

    return {
      message: tsMatch ? tsMatch[2] : "TypeScriptエラー",
      line: lineMatch ? parseInt(lineMatch[1]) : undefined,
      suggestion,
    };
  }

  /**
   * エラー種別に基づく自動修正
   */
  private async autoFixError(error: TestError): Promise<boolean> {
    console.log(`🔧 [AUTO-FIX] 修正試行: ${error.errorType} in ${error.file}`);

    try {
      switch (error.errorType) {
        case "PRISMA_MISSING_FIELD":
          return await this.fixPrismaMissingField(error);

        case "TYPESCRIPT_ERROR":
          return await this.fixTypeScriptError(error);

        case "IMPORT_ERROR":
          return await this.fixImportError(error);

        case "TEST_TIMEOUT":
          return await this.fixTestTimeout(error);

        case "DATABASE_CONNECTION":
          return await this.fixDatabaseConnection(error);

        default:
          console.warn(`⚠️ [AUTO-FIX] 未対応のエラー種別: ${error.errorType}`);
          return false;
      }
    } catch (fixError) {
      console.error(`❌ [AUTO-FIX] 修正処理でエラー:`, fixError);
      return false;
    }
  }

  /**
   * Prisma必須フィールドエラーの修正
   */
  private async fixPrismaMissingField(error: TestError): Promise<boolean> {
    if (!fs.existsSync(error.file)) return false;

    let content = fs.readFileSync(error.file, "utf-8");
    let modified = false;

    // BatchJobStatus修正
    if (
      error.errorMessage.includes("status") &&
      content.includes("db.batchJob.create")
    ) {
      if (!content.includes("status:")) {
        // BatchJobStatusインポート追加
        if (!content.includes("BatchJobStatus")) {
          content = content.replace(
            '} from "@prisma/client"',
            '  BatchJobStatus,\n} from "@prisma/client"',
          );
        }

        // status必須フィールド追加
        content = content.replace(
          /(\s+)(preferredMethod:\s*"[^"]+",)/g,
          "$1$2\n$1status: BatchJobStatus.PENDING,",
        );
        modified = true;
        console.log(
          `✅ [AUTO-FIX] BatchJob.statusフィールドを追加: ${error.file}`,
        );
      }
    }

    // BatchJob totalTasks修正
    if (
      error.errorMessage.includes("totalTasks") &&
      content.includes("db.batchJob.create")
    ) {
      if (!content.includes("totalTasks:")) {
        content = content.replace(
          /(\s+)(status:\s*[^,]+,)/g,
          "$1$2\n$1totalTasks: 0,",
        );
        modified = true;
        console.log(
          `✅ [AUTO-FIX] BatchJob.totalTasksフィールドを追加: ${error.file}`,
        );
      }
    }

    // User必須フィールド修正
    if (
      error.errorMessage.includes("emailVerified") &&
      content.includes("db.user.create")
    ) {
      if (!content.includes("emailVerified:")) {
        content = content.replace(
          /(\s+)(email:\s*[^,]+,)/g,
          "$1$2\n$1emailVerified: true,",
        );
        modified = true;
        console.log(
          `✅ [AUTO-FIX] User.emailVerifiedフィールドを追加: ${error.file}`,
        );
      }
    }

    if (
      error.errorMessage.includes("createdAt") &&
      content.includes("db.user.create")
    ) {
      if (!content.includes("createdAt:")) {
        content = content.replace(
          /(\s+)(emailVerified:\s*[^,]+,)/g,
          "$1$2\n$1createdAt: new Date(),\n$1updatedAt: new Date(),",
        );
        modified = true;
        console.log(
          `✅ [AUTO-FIX] User.createdAt/updatedAtフィールドを追加: ${error.file}`,
        );
      }
    }

    // Product必須フィールド修正
    if (
      error.errorMessage.includes("description") &&
      content.includes("db.Product.create")
    ) {
      const productFields = {
        description: '"テスト商品の説明"',
        usp: '"テスト商品のUSP"',
        challenges: '"テスト商品の課題"',
        textContent: '"テスト商品のテキストコンテンツ"',
      };

      for (const [field, value] of Object.entries(productFields)) {
        if (!content.includes(`${field}:`)) {
          content = content.replace(
            /(\s+)(userId:\s*[^,]+,)/g,
            `$1$2\n$1${field}: ${value},`,
          );
          modified = true;
          console.log(
            `✅ [AUTO-FIX] Product.${field}フィールドを追加: ${error.file}`,
          );
        }
      }
    }

    // JobTemplate必須フィールド修正
    if (
      error.errorMessage.includes("name") &&
      content.includes("db.jobTemplate.create")
    ) {
      if (!content.includes("name:")) {
        // 複数のパターンで修正を試行
        let nameAdded = false;

        // パターン1: titleの後に追加
        if (content.includes("title:")) {
          content = content.replace(
            /(\s+)(title:\s*[^,]+,)/g,
            '$1name: "テスト営業メール",\n$1$2',
          );
          nameAdded = true;
        }
        // パターン2: idの後に追加
        else if (content.includes("id:")) {
          content = content.replace(
            /(\s+)(id:\s*[^,]+,)/g,
            '$1$2\n$1name: "テスト営業メール",',
          );
          nameAdded = true;
        }

        if (nameAdded) {
          modified = true;
          console.log(
            `✅ [AUTO-FIX] JobTemplate.nameフィールドを追加: ${error.file}`,
          );
        }
      }
    }

    if (
      error.errorMessage.includes("category") &&
      content.includes("db.jobTemplate.create")
    ) {
      if (!content.includes("category:")) {
        // 複数のパターンで修正を試行
        let categoryAdded = false;

        if (content.includes("targetIndustry:")) {
          content = content.replace(
            /(\s+)(targetIndustry:\s*[^,]+,)/g,
            '$1$2\n$1category: "new-client-acquisition",',
          );
          categoryAdded = true;
        } else if (content.includes("content:")) {
          content = content.replace(
            /(\s+)(content:\s*[^,]+,)/g,
            '$1$2\n$1category: "new-client-acquisition",',
          );
          categoryAdded = true;
        }

        if (categoryAdded) {
          modified = true;
          console.log(
            `✅ [AUTO-FIX] JobTemplate.categoryフィールドを追加: ${error.file}`,
          );
        }
      }
    }

    if (
      error.errorMessage.includes("user_id") &&
      content.includes("db.jobTemplate.create")
    ) {
      if (!content.includes("userId:") && !content.includes("user_id:")) {
        // 動的にテストユーザーIDを取得
        const userIdPattern = /id:\s*"([^"]*test-user[^"]*)"/.exec(content);
        const testUserId = userIdPattern
          ? userIdPattern[1]
          : "test-user-immediate";

        // 複数のパターンで修正を試行
        let userIdAdded = false;

        if (content.includes("category:")) {
          content = content.replace(
            /(\s+)(category:\s*[^,]+,)/g,
            `$1$2\n$1userId: "${testUserId}",`,
          );
          userIdAdded = true;
        } else if (content.includes("name:")) {
          content = content.replace(
            /(\s+)(name:\s*[^,]+,)/g,
            `$1$2\n$1userId: "${testUserId}",`,
          );
          userIdAdded = true;
        }

        if (userIdAdded) {
          modified = true;
          console.log(
            `✅ [AUTO-FIX] JobTemplate.userIdフィールドを追加: ${error.file} (userId: ${testUserId})`,
          );
        }
      }
    }

    // email null修正
    if (error.stackTrace.includes("Field 'email' cannot be null")) {
      content = content.replace(
        /email:\s*null,?/g,
        'email: "test@example.com",',
      );
      modified = true;
      console.log(`✅ [AUTO-FIX] User.emailのnull値を修正: ${error.file}`);
    }

    // goldenCompany vs company テーブル名修正（コンテンツベース）
    if (
      content.includes("db.company.") &&
      (error.errorMessage.includes("Cannot read properties of undefined") ||
        error.stackTrace.includes("company") ||
        content.includes("db.company.create"))
    ) {
      content = content.replace(/db\.company\./g, "db.goldenCompany.");
      modified = true;
      console.log(
        `✅ [AUTO-FIX] テーブル名をcompany→goldenCompanyに修正: ${error.file}`,
      );
    }

    // Product テーブル名修正（大文字小文字）
    if (content.includes("db.product.") && !content.includes("db.Product.")) {
      content = content.replace(/db\.product\./g, "db.Product.");
      modified = true;
      console.log(
        `✅ [AUTO-FIX] テーブル名をproduct→Productに修正: ${error.file}`,
      );
    }

    if (modified) {
      fs.writeFileSync(error.file, content);
      return true;
    }

    return false;
  }

  /**
   * TypeScriptエラーの修正
   */
  private async fixTypeScriptError(error: TestError): Promise<boolean> {
    if (!fs.existsSync(error.file)) return false;

    const content = fs.readFileSync(error.file, "utf-8");
    let modified = false;

    // 未使用インポートの削除
    if (
      error.errorMessage.includes("is declared but its value is never read")
    ) {
      const unusedVar = error.errorMessage.match(/'([^']+)'/)?.[1];
      if (unusedVar) {
        const modifiedContent = content.replace(
          new RegExp(`\\b${unusedVar}\\b,?\\s*`, "g"),
          "",
        );
        fs.writeFileSync(error.file, modifiedContent);
        modified = true;
      }
    }

    return modified;
  }

  /**
   * インポートエラーの修正
   */
  private async fixImportError(error: TestError): Promise<boolean> {
    if (!fs.existsSync(error.file)) return false;

    const content = fs.readFileSync(error.file, "utf-8");

    // 一般的な修正パターン
    if (error.stackTrace.includes("BatchJobStatus")) {
      if (!content.includes("BatchJobStatus")) {
        const modifiedContent = content.replace(
          '} from "@prisma/client"',
          '  BatchJobStatus,\n} from "@prisma/client"',
        );
        fs.writeFileSync(error.file, modifiedContent);
        console.log(
          `✅ [AUTO-FIX] BatchJobStatusインポートを追加: ${error.file}`,
        );
        return true;
      }
    }

    return false;
  }

  /**
   * テストタイムアウトの修正
   */
  private async fixTestTimeout(error: TestError): Promise<boolean> {
    if (!fs.existsSync(error.file)) return false;

    const content = fs.readFileSync(error.file, "utf-8");

    // タイムアウト値の調整
    const modifiedContent = content
      .replace(/waitForTimeout\((\d+)\)/g, (match, timeout) => {
        const newTimeout = Math.min(parseInt(timeout) * 2, 10000);
        return `waitForTimeout(${newTimeout})`;
      })
      .replace(/timeout:\s*(\d+)/g, (match, timeout) => {
        const newTimeout = Math.min(parseInt(timeout) * 2, 120000);
        return `timeout: ${newTimeout}`;
      });

    if (modifiedContent !== content) {
      fs.writeFileSync(error.file, modifiedContent);
      console.log(`✅ [AUTO-FIX] タイムアウト値を調整: ${error.file}`);
      return true;
    }

    return false;
  }

  /**
   * データベース接続エラーの修正
   */
  private async fixDatabaseConnection(error: TestError): Promise<boolean> {
    if (!fs.existsSync(error.file)) return false;

    const content = fs.readFileSync(error.file, "utf-8");

    // PrismaClient初期化の修正
    if (
      content.includes("new PrismaClient()") &&
      !content.includes("datasources")
    ) {
      const modifiedContent = content.replace(
        "new PrismaClient()",
        `new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL,
    },
  },
})`,
      );
      fs.writeFileSync(error.file, modifiedContent);
      console.log(`✅ [AUTO-FIX] PrismaClient初期化を修正: ${error.file}`);
      return true;
    }

    return false;
  }

  /**
   * テスト実行と自動修正の繰り返し
   */
  public async fixTestsUntilSuccess(testFiles: string[]): Promise<boolean> {
    console.log(
      `🤖 [AUTO-FIX] テスト自動修正開始: ${testFiles.length}ファイル`,
    );

    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      console.log(`\n🔄 [AUTO-FIX] 修正試行 ${attempt}/${this.maxAttempts}`);

      const allErrors: TestError[] = [];
      let allTestsPassed = true;

      // 各テストファイルを実行
      for (const testFile of testFiles) {
        try {
          const command = this.getTestCommand(testFile);
          console.log(`🧪 [AUTO-FIX] 実行中: ${testFile}`);

          execSync(command, {
            encoding: "utf-8",
            timeout: 60000,
            cwd: process.cwd(),
          });

          console.log(`✅ [AUTO-FIX] 成功: ${testFile}`);
        } catch (error: any) {
          console.log(`❌ [AUTO-FIX] 失敗: ${testFile}`);
          allTestsPassed = false;

          // デバッグ情報を出力
          console.log("=== ERROR DEBUG INFO ===");
          console.log("stderr:", error.stderr);
          console.log("stdout:", error.stdout);
          console.log("error.message:", error.message);
          console.log("========================");

          const errors = this.analyzeTestError(
            error.stderr || "",
            error.stdout || "",
            testFile,
          );
          console.log(`🔍 [AUTO-FIX] 検出されたエラー数: ${errors.length}`);
          allErrors.push(...errors);
        }
      }

      // 全テスト成功
      if (allTestsPassed) {
        console.log(
          `\n🎉 [AUTO-FIX] 全テスト成功！ (${attempt}回目の試行で完了)`,
        );
        this.recordFixAttempt(attempt, [], true, []);
        return true;
      }

      // エラー修正の試行
      console.log(`\n🔧 [AUTO-FIX] ${allErrors.length}個のエラーを修正中...`);
      const changes: string[] = [];

      for (const error of allErrors) {
        const fixed = await this.autoFixError(error);
        if (fixed) {
          changes.push(`${error.errorType} in ${error.file}`);
        }
      }

      this.recordFixAttempt(attempt, changes, false, allErrors);

      if (changes.length === 0) {
        console.error(
          `❌ [AUTO-FIX] 修正できないエラーがあります。手動対応が必要です。`,
        );
        this.displayUnfixableErrors(allErrors);
        return false;
      }

      console.log(`✅ [AUTO-FIX] ${changes.length}個の修正を適用しました`);
    }

    console.error(
      `❌ [AUTO-FIX] ${this.maxAttempts}回の試行で修正完了できませんでした`,
    );
    return false;
  }

  /**
   * テストコマンドの生成
   */
  private getTestCommand(filePath: string): string {
    if (filePath.includes("tests/e2e/")) {
      return `npx playwright test "${filePath}"`;
    } else {
      return `npm run test:vitest ${filePath}`;
    }
  }

  /**
   * 修正試行の記録
   */
  private recordFixAttempt(
    attempt: number,
    changes: string[],
    success: boolean,
    remainingErrors: TestError[],
  ): void {
    const fixAttempt: FixAttempt = {
      attempt,
      timestamp: new Date().toISOString(),
      changes,
      success,
      remainingErrors,
    };

    this.fixLog.push(fixAttempt);

    // ログファイルに保存
    const logFile = ".claude/output/data/auto-fix-log.json";
    fs.writeFileSync(logFile, JSON.stringify(this.fixLog, null, 2));
  }

  /**
   * 修正不可能エラーの表示
   */
  private displayUnfixableErrors(errors: TestError[]): void {
    console.log("\n🔴 [AUTO-FIX] 自動修正できないエラー:");
    errors.forEach((error, index) => {
      console.log(`\n${index + 1}. ${error.file}`);
      console.log(`   エラー種別: ${error.errorType}`);
      console.log(`   メッセージ: ${error.errorMessage}`);
      console.log(`   推奨対応: ${error.suggestion}`);
    });

    console.log("\n🛠️ 手動修正後、再度テストを実行してください。");
  }
}

/**
 * メイン実行関数
 */
export default function autoFixTestErrors(): void {
  const fixer = new AutoTestErrorFixer();

  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.log("使用方法:");
    console.log(
      "  npx tsx .claude/auto-fix-test-errors.ts <test-file1> [test-file2] ...",
    );
    process.exit(1);
  }

  const testFiles = args.filter((file) => fs.existsSync(file));
  if (testFiles.length === 0) {
    console.error("❌ 有効なテストファイルが見つかりません");
    process.exit(1);
  }

  fixer.fixTestsUntilSuccess(testFiles).then((success) => {
    process.exit(success ? 0 : 1);
  });
}

// スクリプトとして実行された場合
if (import.meta.url === `file://${process.argv[1]}`) {
  autoFixTestErrors();
}
