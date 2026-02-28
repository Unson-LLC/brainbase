#!/usr/bin/env tsx

/**
 * PR作成前検証スクリプト
 *
 * このスクリプトは以下を検証します：
 * 1. ステージされた変更の分析
 * 2. コミット履歴の確認
 * 3. メイン機能の特定
 * 4. PRタイトル・説明の妥当性チェック
 */

import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

import type { StagedAnalysis } from "../../../../src/types/claude-hooks.js";

/**
 * ステージされた変更を分析
 */
function analyzeStagedChanges(): StagedAnalysis {
  try {
    // ステージされたファイル一覧
    const stagedFiles = execSync("git diff --cached --name-only", {
      encoding: "utf8",
    })
      .trim()
      .split("\n")
      .filter((f) => f);

    // 変更種別の分析
    const diffStat = execSync("git diff --cached --name-status", {
      encoding: "utf8",
    })
      .trim()
      .split("\n");

    const modifiedFiles: string[] = [];
    const newFiles: string[] = [];
    const deletedFiles: string[] = [];

    diffStat.forEach((line) => {
      const [status, file] = line.split("\t");
      switch (status) {
        case "M":
          modifiedFiles.push(file);
          break;
        case "A":
          newFiles.push(file);
          break;
        case "D":
          deletedFiles.push(file);
          break;
      }
    });

    // コミット履歴（mainブランチとの差分）
    const commitHistory = execSync("git log --oneline main..HEAD", {
      encoding: "utf8",
    })
      .trim()
      .split("\n")
      .filter((h) => h);

    // メイン機能の特定
    const mainFeature = identifyMainFeature(
      stagedFiles,
      newFiles,
      commitHistory,
    );

    // 推奨タイトルと説明の生成
    const recommendedTitle = generateRecommendedTitle(mainFeature, stagedFiles);
    const recommendedDescription = generateRecommendedDescription(
      mainFeature,
      stagedFiles,
      newFiles,
      modifiedFiles,
    );

    return {
      stagedFiles,
      modifiedFiles,
      newFiles,
      deletedFiles,
      commitHistory,
      mainFeature,
      recommendedTitle,
      recommendedDescription,
    };
  } catch (error) {
    console.error("❌ ステージ変更の分析に失敗:", error);
    process.exit(1);
  }
}

/**
 * メイン機能を特定
 */
function identifyMainFeature(
  stagedFiles: string[],
  newFiles: string[],
  commitHistory: string[],
): string {
  try {
    // 1. ブランチ名から主機能を推定（最優先）
    const currentBranch = execSync("git branch --show-current", {
      encoding: "utf8",
    }).trim();
    if (currentBranch.includes("password-reset")) {
      return "パスワードリセット機能";
    }
    if (currentBranch.includes("auth")) {
      return "認証機能";
    }
    if (currentBranch.includes("user-management")) {
      return "ユーザー管理機能";
    }

    // 2. API routes の新規作成を検出
    const apiRoutes = newFiles.filter((f) => f.includes("/api/"));
    if (apiRoutes.length > 0) {
      const routePath = apiRoutes[0].split("/api/")[1];
      if (routePath.includes("password") || routePath.includes("reset")) {
        return "パスワードリセット機能";
      }
      if (routePath.includes("auth")) {
        return "認証機能";
      }
      const feature = routePath.split("/")[0];
      return `${feature}機能`;
    }

    // 3. コンポーネント・ページディレクトリから推定
    const componentDirs = newFiles
      .filter((f) => f.includes("/components/") || f.includes("/app/"))
      .map((f) => {
        if (f.includes("/reset-password") || f.includes("/forgot-password")) {
          return "パスワードリセット機能";
        }
        if (f.includes("/components/")) {
          return f.split("/components/")[1].split("/")[0] + "機能";
        }
        if (f.includes("/app/")) {
          const appPath = f.split("/app/")[1];
          if (appPath.includes("password") || appPath.includes("reset")) {
            return "パスワードリセット機能";
          }
          return appPath.split("/")[0] + "機能";
        }
        return null;
      })
      .filter(Boolean);

    if (componentDirs.length > 0) {
      return componentDirs[0]!;
    }

    // 4. フック・ライブラリファイルから推定
    const hookFiles = newFiles.filter(
      (f) => f.includes("/hooks/") || f.includes("/lib/"),
    );
    if (hookFiles.length > 0) {
      const passwordResetFiles = hookFiles.filter(
        (f) =>
          f.includes("password") ||
          f.includes("reset") ||
          f.includes("PasswordReset"),
      );
      if (passwordResetFiles.length > 0) {
        return "パスワードリセット機能";
      }
    }

    // 5. コミット履歴から推定（重要な機能コミットを優先）
    const importantCommits = commitHistory
      .filter(
        (commit) =>
          commit.includes("feat:") ||
          commit.includes("add:") ||
          commit.includes("implement"),
      )
      .filter(
        (commit) =>
          !commit.includes("docs:") &&
          !commit.includes("chore:") &&
          !commit.includes("style:") &&
          !commit.includes("hook"),
      );

    for (const commit of importantCommits) {
      if (commit.includes("password") || commit.includes("reset")) {
        return "パスワードリセット機能";
      }
      if (commit.includes("auth")) {
        return "認証機能";
      }
    }

    // 6. ファイル名から推定
    const featureFiles = stagedFiles
      .filter((f) => !f.includes(".claude/") && !f.includes("docs/"))
      .filter(
        (f) =>
          f.includes("password") ||
          f.includes("reset") ||
          f.includes("auth") ||
          f.includes("PasswordReset"),
      );

    if (featureFiles.length > 0) {
      return "パスワードリセット機能";
    }

    // 7. フォールバック - 最初の重要なコミットから抽出
    if (importantCommits.length > 0) {
      const firstCommit = importantCommits[0].split(":")[1]?.trim();
      return firstCommit || "機能追加";
    }

    return "機能追加";
  } catch (error) {
    console.error("機能特定中にエラー:", error);
    return "機能追加";
  }
}

/**
 * 推奨PRタイトルを生成
 */
function generateRecommendedTitle(
  mainFeature: string,
  stagedFiles: string[],
): string {
  const fileCount = stagedFiles.length;

  if (mainFeature.includes("password") || mainFeature.includes("reset")) {
    return `feat: パスワードリセット機能の実装 (${fileCount}ファイル)`;
  }

  if (mainFeature.includes("auth")) {
    return `feat: 認証機能の実装 (${fileCount}ファイル)`;
  }

  return `feat: ${mainFeature}の実装 (${fileCount}ファイル)`;
}

/**
 * 推奨PR説明を生成
 */
function generateRecommendedDescription(
  mainFeature: string,
  stagedFiles: string[],
  newFiles: string[],
  modifiedFiles: string[],
): string {
  let description = `## 概要\n${mainFeature}を実装しました。\n\n`;

  // 新規ファイルの説明
  if (newFiles.length > 0) {
    description += `## 新規追加ファイル (${newFiles.length}件)\n`;
    newFiles.slice(0, 10).forEach((file) => {
      description += `- \`${file}\`\n`;
    });
    if (newFiles.length > 10) {
      description += `- ... 他${newFiles.length - 10}件\n`;
    }
    description += "\n";
  }

  // 変更ファイルの説明
  if (modifiedFiles.length > 0) {
    description += `## 変更ファイル (${modifiedFiles.length}件)\n`;
    modifiedFiles.slice(0, 10).forEach((file) => {
      description += `- \`${file}\`\n`;
    });
    if (modifiedFiles.length > 10) {
      description += `- ... 他${modifiedFiles.length - 10}件\n`;
    }
    description += "\n";
  }

  description += `## テスト\n- [ ] 機能テストの実行\n- [ ] 型チェック通過\n- [ ] ESLint通過\n\n`;
  description += `🤖 Generated with [Claude Code](https://claude.ai/code)`;

  return description;
}

/**
 * 検証結果を出力
 */
function outputVerificationResult(analysis: StagedAnalysis) {
  console.log("📊 PR作成前検証結果");
  console.log("═".repeat(50));
  console.log(`📁 ステージファイル数: ${analysis.stagedFiles.length}`);
  console.log(`✨ 新規ファイル数: ${analysis.newFiles.length}`);
  console.log(`📝 変更ファイル数: ${analysis.modifiedFiles.length}`);
  console.log(`🎯 メイン機能: ${analysis.mainFeature}`);
  console.log("═".repeat(50));

  console.log("🏷️  推奨PRタイトル:");
  console.log(`   ${analysis.recommendedTitle}`);
  console.log("");

  console.log("📄 推奨PR説明:");
  console.log(analysis.recommendedDescription);
  console.log("");

  console.log("⚠️  重要な注意事項:");
  console.log("   PRタイトルと説明は上記の分析結果に基づいて作成してください");
  console.log(
    "   最近の作業内容ではなく、ステージされた変更の全体を反映してください",
  );
}

/**
 * メイン実行
 */
function main() {
  console.log("🔍 PR作成前の変更内容を分析中...\n");

  const analysis = analyzeStagedChanges();
  outputVerificationResult(analysis);
}

// スクリプトが直接実行された場合のみ実行
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export {
  analyzeStagedChanges,
  identifyMainFeature,
  generateRecommendedTitle,
  generateRecommendedDescription,
};
