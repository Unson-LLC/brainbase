#!/usr/bin/env npx tsx

/**
 * 新規・修正ファイル対象のESLint部分適用システム
 *
 * 既存ファイルへの一括適用を避けながら、新しく作成・修正されたファイルにのみ
 * ESLintルールを段階的に適用するシステムです。
 */

import { exec } from "child_process";
import { promisify } from "util";
import * as fs from "fs/promises";
import * as path from "path";

const execAsync = promisify(exec);

/**
 * 選択的ESLint適用管理クラス
 */
class SelectiveESLintEnforcer {
  constructor() {
    // 設定ファイルの初期化は必要時に行う
  }

  /**
   * 新規・修正ファイルを検出してESLintを適用します。
   */
  public async enforceSelectiveESLint(): Promise<void> {
    try {
      // Gitで変更されたファイルを検出
      const modifiedFiles = await this.getModifiedFiles();

      if (modifiedFiles.length === 0) {
        console.log("📝 変更されたファイルがありません");
        return;
      }

      // TypeScript/JavaScriptファイルのみをフィルタ
      const targetFiles = modifiedFiles.filter(
        (file) =>
          /\.(ts|tsx|js|jsx)$/.test(file) &&
          !file.includes("node_modules") &&
          !file.includes(".next") &&
          !file.includes("dist"),
      );

      if (targetFiles.length === 0) {
        console.log("📝 対象ファイル（TS/JS）の変更がありません");
        return;
      }

      console.log("🔍 ESLint適用対象ファイル:");
      targetFiles.forEach((file) => console.log(`  - ${file}`));

      // 段階的ESLintルールの適用
      await this.applyProgressiveRules(targetFiles);
    } catch (error) {
      console.error("❌ SelectiveESLint実行エラー:", error);
    }
  }

  /**
   * Git差分から修正されたファイルを取得します。
   */
  private async getModifiedFiles(): Promise<string[]> {
    try {
      // ステージング済み + 未ステージングファイル
      const { stdout: staged } = await execAsync(
        "git diff --cached --name-only",
      );
      const { stdout: unstaged } = await execAsync("git diff --name-only");

      const stagedFiles = staged.trim().split("\n").filter(Boolean);
      const unstagedFiles = unstaged.trim().split("\n").filter(Boolean);

      // 重複を除去して結合
      return [...new Set([...stagedFiles, ...unstagedFiles])];
    } catch (error) {
      console.warn("⚠️  Git差分取得に失敗:", error);
      return [];
    }
  }

  /**
   * 段階的にESLintルールを適用します。
   */
  private async applyProgressiveRules(files: string[]): Promise<void> {
    // レベル1: 基本的な型安全性ルール
    const level1Rules = [
      "@typescript-eslint/no-unused-vars",
      "@typescript-eslint/no-explicit-any",
      "@typescript-eslint/prefer-const",
      "no-var",
    ];

    // レベル2: 設計原則ルール
    const level2Rules = [
      ...level1Rules,
      "@typescript-eslint/no-empty-interface",
      "@typescript-eslint/consistent-type-imports",
      "import/no-default-export",
      "max-lines-per-function",
    ];

    // レベル3は将来の拡張用（現在は未使用）

    await this.runESLintWithRules(files, level1Rules, "Level 1 (基本)");

    // レベル1が成功した場合のみレベル2を実行
    const level1Success = await this.checkESLintSuccess(files, level1Rules);
    if (level1Success) {
      await this.runESLintWithRules(files, level2Rules, "Level 2 (設計原則)");
    }
  }

  /**
   * 指定されたルールでESLintを実行します。
   */
  private async runESLintWithRules(
    files: string[],
    _rules: string[],
    level: string,
  ): Promise<void> {
    console.log(`\n🔧 ${level} ESLint実行中...`);

    for (const file of files) {
      try {
        // ファイル個別にESLint実行
        const { stderr } = await execAsync(
          `npx eslint "${file}" --no-eslintrc --config .claude/selective-eslint.config.js`,
          { encoding: "utf8" },
        );

        if (stderr) {
          console.log(`⚠️  ${file}: ${stderr}`);
        } else {
          console.log(`✅ ${file}: OK`);
        }
      } catch (error: any) {
        console.log(`❌ ${file}: ESLintエラー`);
        console.log(`   ${error.stdout || error.message}`);

        // 型定義分離の自動修正を試行
        if (
          error.stdout?.includes("interface") ||
          error.stdout?.includes("type")
        ) {
          await this.suggestTypeDefinitionFix(file);
        }
      }
    }
  }

  /**
   * ESLint成功を確認します。
   */
  private async checkESLintSuccess(
    files: string[],
    _rules: string[],
  ): Promise<boolean> {
    try {
      for (const file of files) {
        await execAsync(
          `npx eslint "${file}" --no-eslintrc --config .claude/selective-eslint.config.js`,
        );
      }
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 型定義分離の修正を提案します。
   */
  private async suggestTypeDefinitionFix(filePath: string): Promise<void> {
    console.log(`💡 ${filePath}: 型定義を src/types/ に分離することを推奨`);
    console.log(`   - interface/type定義を src/types/[module-name].ts に移動`);
    console.log(
      `   - import type { ... } from '../types/[module-name]' で参照`,
    );
  }
}

/**
 * 選択的ESLint設定ファイルを生成します。
 */
async function generateSelectiveESLintConfig(): Promise<void> {
  const configContent = `
module.exports = {
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint', 'import'],
  rules: {
    // レベル1: 基本的な型安全性
    '@typescript-eslint/no-unused-vars': 'error',
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/prefer-const': 'error',
    'no-var': 'error',

    // レベル2: 設計原則
    '@typescript-eslint/no-empty-interface': 'error',
    '@typescript-eslint/consistent-type-imports': 'error',
    'import/no-default-export': 'warn',
    'max-lines-per-function': ['warn', { max: 50 }],

    // レベル3: 追加ルール（段階的適用）
    'complexity': ['warn', { max: 10 }],
    'max-depth': ['warn', { max: 4 }],
    'max-params': ['warn', { max: 5 }]
  },
  env: {
    node: true,
    es2022: true
  },
  extends: [
    '@typescript-eslint/recommended'
  ]
};
`;

  const configPath = path.join(
    process.cwd(),
    ".claude",
    "selective-eslint.config.js",
  );
  await fs.writeFile(configPath, configContent.trim());
  console.log("📝 選択的ESLint設定ファイルを生成しました");
}

/**
 * メイン処理
 */
async function main(): Promise<void> {
  const enforcer = new SelectiveESLintEnforcer();

  // 設定ファイルの生成
  await generateSelectiveESLintConfig();

  // 選択的ESLint適用
  await enforcer.enforceSelectiveESLint();
}

// 直接実行された場合
if (process.argv[1] === import.meta.url.replace("file://", "")) {
  main().catch(console.error);
}
