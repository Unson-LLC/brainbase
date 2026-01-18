#!/usr/bin/env tsx

/**
 * Git Pre-commit検証スクリプト
 *
 * コミット前に以下を自動チェック：
 * 1. 不要ファイルのステージング防止（test-reports, logs, cacheファイル等）
 * 2. 設定ファイルの意図しない変更の警告
 * 3. 大きなファイルのコミット防止
 * 4. セキュリティ関連ファイルのチェック
 */

import { execSync } from "child_process";
import * as fs from "fs";
import { PrismaMigrationValidator } from "../../../../scripts/validate-prisma-migrations.js";
import type {
  CommitAnalysis,
  ProblemFile,
  ForbiddenPattern,
} from "../../../../src/types/pre-commit-types.js";

/**
 * 禁止ファイルパターン
 */
const FORBIDDEN_PATTERNS: ForbiddenPattern[] = [
  // 自動生成ファイル
  {
    pattern: /^test-reports\//,
    reason: "テストレポートファイル（自動生成）",
    severity: "error" as const,
  },
  { pattern: /\.log$/, reason: "ログファイル", severity: "error" as const },
  {
    pattern: /dump\.rdb$/,
    reason: "Redisダンプファイル",
    severity: "error" as const,
  },
  {
    pattern: /node_modules\//,
    reason: "node_modulesディレクトリ",
    severity: "error" as const,
  },
  {
    pattern: /\.cache\//,
    reason: "キャッシュディレクトリ",
    severity: "error" as const,
  },

  // セキュリティ関連
  { pattern: /\.env$/, reason: "環境変数ファイル", severity: "error" as const },
  {
    pattern: /\.env\./,
    reason: "環境変数ファイル",
    severity: "error" as const,
  },
  {
    pattern: /private.*key/i,
    reason: "秘密鍵ファイル",
    severity: "error" as const,
  },
  { pattern: /\.pem$/, reason: "証明書ファイル", severity: "error" as const },

  // 一時ファイル
  { pattern: /~$/, reason: "バックアップファイル", severity: "error" as const },
  { pattern: /\.tmp$/, reason: "一時ファイル", severity: "error" as const },
  {
    pattern: /\.bak$/,
    reason: "バックアップファイル",
    severity: "error" as const,
  },
];

/**
 * 注意すべき設定ファイル
 */
const CONFIG_FILES = [
  "docker-compose.yml",
  "package.json",
  "tsconfig.json",
  "next.config.js",
  "prisma/schema.prisma",
];

/**
 * 最大ファイルサイズ（バイト）
 */
const MAX_FILE_SIZE = 1024 * 1024; // 1MB

/**
 * Prismaスキーマ検証を実行
 */
async function validatePrismaSchema(stagedFiles: string[]) {
  const hasSchemaChanges = stagedFiles.some((file) =>
    file.includes("prisma/schema.prisma"),
  );

  if (!hasSchemaChanges) {
    return { hasSchemaChanges: false };
  }

  console.log("🔍 Prismaスキーマ変更を検出 - 検証を実行中...");

  try {
    const validator = new PrismaMigrationValidator();
    const validationResult = await validator.validateMigrations();
    return { hasSchemaChanges: true, validationResult };
  } catch (error) {
    console.error("❌ Prismaスキーマ検証エラー:", error);
    return {
      hasSchemaChanges: true,
      validationResult: {
        isValid: false,
        errors: [error.message],
        warnings: [],
      },
    };
  }
}

/**
 * ステージされたファイルを分析
 */
async function analyzeCommit(): Promise<CommitAnalysis> {
  try {
    // ステージされたファイル一覧
    const stagedFiles = execSync("git diff --cached --name-only", {
      encoding: "utf8",
    })
      .trim()
      .split("\n")
      .filter((f) => f);

    if (stagedFiles.length === 0) {
      return {
        stagedFiles: [],
        problematicFiles: [],
        warnings: [],
        errors: [],
        shouldBlock: false,
      };
    }

    const problematicFiles: ProblemFile[] = [];
    const warnings: string[] = [];
    const errors: string[] = [];

    // 各ファイルをチェック
    for (const filePath of stagedFiles) {
      // 禁止パターンチェック
      for (const { pattern, reason, severity } of FORBIDDEN_PATTERNS) {
        if (pattern.test(filePath)) {
          problematicFiles.push({
            path: filePath,
            reason,
            severity,
          });
          if (severity === "error") {
            errors.push(`❌ ${filePath}: ${reason}`);
          } else {
            warnings.push(`⚠️  ${filePath}: ${reason}`);
          }
          break;
        }
      }

      // ファイルサイズチェック（存在するファイルのみ）
      if (fs.existsSync(filePath)) {
        const stats = fs.statSync(filePath);
        if (stats.size > MAX_FILE_SIZE) {
          const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
          problematicFiles.push({
            path: filePath,
            reason: `ファイルサイズが大きすぎます (${sizeMB}MB > 1MB)`,
            severity: "error",
            size: stats.size,
          });
          errors.push(
            `❌ ${filePath}: ファイルサイズが大きすぎます (${sizeMB}MB)`,
          );
        }
      }

      // 設定ファイルの警告
      if (CONFIG_FILES.includes(filePath)) {
        warnings.push(
          `⚠️  ${filePath}: 設定ファイルの変更です - 意図的な変更か確認してください`,
        );
      }
    }

    // git add . の使用を検出
    try {
      const gitHistory = execSync("history | tail -10", {
        encoding: "utf8",
        stdio: "pipe",
      });
      if (typeof gitHistory === "string" && gitHistory.includes("git add .")) {
        warnings.push(
          '⚠️  最近 "git add ." を使用した可能性があります - 個別ファイル指定を推奨',
        );
      }
    } catch {
      // history コマンドが失敗した場合は無視
    }

    // Prismaスキーマ検証を実行
    const prismaValidation = await validatePrismaSchema(stagedFiles);

    if (prismaValidation.validationResult) {
      const result = prismaValidation.validationResult;

      // Prismaエラーを追加
      if (result.errors && result.errors.length > 0) {
        errors.push(...result.errors.map((err: string) => `🔍 Prisma: ${err}`));
      }

      // Prisma警告を追加
      if (result.warnings && result.warnings.length > 0) {
        warnings.push(
          ...result.warnings.map((warn: string) => `🔍 Prisma: ${warn}`),
        );
      }
    }

    return {
      stagedFiles,
      problematicFiles,
      warnings,
      errors,
      shouldBlock: errors.length > 0,
      prismaValidation,
    };
  } catch (error) {
    console.error("❌ コミット分析に失敗:", error);
    return {
      stagedFiles: [],
      problematicFiles: [],
      warnings: [],
      errors: ["コミット分析エラー"],
      shouldBlock: true,
    };
  }
}

/**
 * 分析結果を出力
 */
function outputAnalysis(analysis: CommitAnalysis) {
  console.log("🔍 Pre-commit検証結果");
  console.log("═".repeat(50));

  if (analysis.stagedFiles.length === 0) {
    console.log("📁 ステージされたファイルがありません");
    return;
  }

  console.log(`📁 ステージファイル数: ${analysis.stagedFiles.length}`);

  // エラー表示
  if (analysis.errors.length > 0) {
    console.log("\n🚨 エラー（コミット阻止）:");
    analysis.errors.forEach((error) => console.log(`  ${error}`));
  }

  // 警告表示
  if (analysis.warnings.length > 0) {
    console.log("\n⚠️  警告:");
    analysis.warnings.forEach((warning) => console.log(`  ${warning}`));
  }

  // 正常ファイル一覧
  const normalFiles = analysis.stagedFiles.filter(
    (file) => !analysis.problematicFiles.some((p) => p.path === file),
  );

  if (normalFiles.length > 0) {
    console.log("\n✅ 正常ファイル:");
    normalFiles.forEach((file) => console.log(`  📄 ${file}`));
  }

  console.log("═".repeat(50));

  if (analysis.shouldBlock) {
    console.log("\n❌ コミットをブロックしました");
    console.log("   問題を修正してから再度コミットしてください");
    console.log("\n💡 修正方法:");
    console.log("   git reset HEAD <filename>  # 特定ファイルのステージを解除");
    console.log("   git reset HEAD .           # 全ファイルのステージを解除");
  } else if (analysis.warnings.length > 0) {
    console.log("\n⚠️  警告がありますが、コミットは続行されます");
    console.log("   設定ファイルの変更が意図的であることを確認してください");
  } else {
    console.log("\n✅ 問題ありません - コミットを続行できます");
  }
}

/**
 * メイン実行
 */
async function main() {
  const analysis = await analyzeCommit();
  outputAnalysis(analysis);

  // エラーがある場合は非ゼロで終了
  if (analysis.shouldBlock) {
    process.exit(1);
  }
}

// スクリプトが直接実行された場合のみ実行
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { analyzeCommit, FORBIDDEN_PATTERNS, CONFIG_FILES };
