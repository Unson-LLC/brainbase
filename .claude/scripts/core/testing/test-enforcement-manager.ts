/**
 * テスト検証強制実行システム
 *
 * Claude Codeのhookシステムから自動実行され、
 * テスト関連の作業完了時に必ずテスト検証を行います。
 */

import { execSync } from "child_process";
import * as path from "path";
import * as fs from "fs";

/**
 * テスト強制実行クラス
 */
export class TestEnforcementManager {
  private projectRoot: string;

  constructor(projectRoot: string = process.cwd()) {
    this.projectRoot = projectRoot;
  }

  /**
   * Gitから変更されたテストファイルを検出
   */
  private getModifiedTestFiles(): string[] {
    const testFiles: string[] = [];

    try {
      // ステージされたファイル
      const stagedFiles = execSync("git diff --cached --name-only", {
        encoding: "utf8",
        cwd: this.projectRoot,
      })
        .trim()
        .split("\n")
        .filter(Boolean);

      // 変更されたファイル（未ステージ）
      const modifiedFiles = execSync("git diff --name-only", {
        encoding: "utf8",
        cwd: this.projectRoot,
      })
        .trim()
        .split("\n")
        .filter(Boolean);

      // 新規追加ファイル（untracked）
      const untrackedFiles = execSync(
        "git ls-files --others --exclude-standard",
        {
          encoding: "utf8",
          cwd: this.projectRoot,
        },
      )
        .trim()
        .split("\n")
        .filter(Boolean);

      // すべてのファイルを統合
      const allFiles = [
        ...new Set([...stagedFiles, ...modifiedFiles, ...untrackedFiles]),
      ];

      // テストファイルのみフィルタリング
      const testPattern = /\.test\.(ts|tsx|js|jsx)$/;
      allFiles.forEach((file) => {
        if (testPattern.test(file)) {
          testFiles.push(file);
        }
      });

      // 関連する実装ファイルのテストも検出
      const implementationFiles = allFiles.filter(
        (file) =>
          !testPattern.test(file) &&
          /\.(ts|tsx|js|jsx)$/.test(file) &&
          !file.includes("test"),
      );

      implementationFiles.forEach((implFile) => {
        // 実装ファイルに対応するテストファイルを探す
        const baseName = implFile.replace(/\.(ts|tsx|js|jsx)$/, "");
        const possibleTestFiles = [
          `tests/unit/${baseName}.test.ts`,
          `tests/unit/${baseName}.test.tsx`,
          `tests/integration/${baseName}.test.ts`,
          `tests/e2e/${baseName}.spec.ts`,
          `${baseName}.test.ts`,
          `${baseName}.test.tsx`,
        ];

        possibleTestFiles.forEach((testFile) => {
          if (fs.existsSync(path.resolve(this.projectRoot, testFile))) {
            testFiles.push(testFile);
          }
        });
      });
    } catch (error) {
      console.log("⚠️  Git情報の取得に失敗しました。");
    }

    return [...new Set(testFiles)]; // 重複を削除
  }

  /**
   * テスト実行
   */
  private runTest(testFile: string): { success: boolean; error?: any } {
    console.log(`\n📝 テスト実行中: ${testFile}`);

    try {
      // ファイルが存在するか確認
      const testPath = path.resolve(this.projectRoot, testFile);

      if (!fs.existsSync(testPath)) {
        console.log(`⚠️  ${testFile} が見つかりません。スキップします。`);
        return { success: true }; // スキップは成功扱い
      }

      // Vitestでテストを実行
      execSync(`npm run test:vitest -- ${testFile}`, {
        encoding: "utf8",
        stdio: "inherit",
        timeout: 120000,
        cwd: this.projectRoot,
      });

      console.log(`✅ ${testFile} のテストが成功しました。`);
      return { success: true };
    } catch (error) {
      console.error(`\n❌ ${testFile} のテストが失敗しました。`);
      return { success: false, error };
    }
  }

  /**
   * 結果サマリー表示
   */
  private displaySummary(
    results: { file: string; success: boolean; error?: any }[],
  ): boolean {
    console.log("\n" + "=".repeat(60));
    console.log("📊 テスト検証結果サマリー");
    console.log("=".repeat(60));

    let hasFailure = false;
    results.forEach((result) => {
      const status = result.success ? "✅ 成功" : "❌ 失敗";
      console.log(`${status}: ${result.file}`);
      if (!result.success) {
        hasFailure = true;
      }
    });

    return hasFailure;
  }

  /**
   * メイン実行
   */
  public async enforce(userPrompt: string = ""): Promise<void> {
    console.log("🔒 テスト検証強制実行中...");
    console.log("この処理は自動化されており、スキップできません。");

    // ユーザーのプロンプトからテストファイルパスを抽出
    const testFileMatch = userPrompt.match(
      /tests?\/[^\s"']+\.test\.(ts|tsx|js|jsx)/gi,
    );

    // テスト実行対象を決定
    let testsToRun: string[] = [];

    if (testFileMatch && testFileMatch.length > 0) {
      // プロンプトで明示的に指定されたテストを優先
      testsToRun = [...testFileMatch];
    } else {
      // Gitから変更されたテストファイルを自動検出
      testsToRun = this.getModifiedTestFiles();

      if (testsToRun.length === 0) {
        console.log("⚠️  変更されたテストファイルが見つかりません。");
        return;
      }
    }

    console.log(`\n🎯 検証対象テストファイル:`);
    testsToRun.forEach((file) => console.log(`  - ${file}`));

    const results: { file: string; success: boolean; error?: any }[] = [];

    // 各テストファイルを実行
    for (const testFile of testsToRun) {
      const result = this.runTest(testFile);
      results.push({ file: testFile, ...result });
    }

    // 結果サマリー表示
    const hasFailure = this.displaySummary(results);

    if (hasFailure) {
      console.error("\n💡 すべてのテストが成功するまで作業を続行できません。");

      // テスト失敗時の通知
      try {
        execSync(
          'npx tsx .claude/scripts/lib/notification/notifier.ts error "テスト検証失敗"',
          {
            encoding: "utf8",
            cwd: this.projectRoot,
            timeout: 10000,
          },
        );
      } catch (notificationError) {
        console.log("通知の送信に失敗しましたが、処理を続行します。");
      }

      throw new Error("テスト検証に失敗しました");
    }

    console.log("\n✅ すべてのテスト検証が正常に完了しました。");

    // テスト成功時の通知
    try {
      const totalTests = results.filter((r) => r.success).length;
      execSync(
        `npx tsx .claude/scripts/lib/notification/notifier.ts complete "テスト検証完了 (${totalTests}件成功)"`,
        {
          encoding: "utf8",
          cwd: this.projectRoot,
          timeout: 10000,
        },
      );
    } catch (notificationError) {
      console.log("通知の送信に失敗しましたが、処理を続行します。");
    }
  }
}
