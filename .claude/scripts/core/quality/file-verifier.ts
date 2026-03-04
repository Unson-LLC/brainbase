/**
 * ファイル検証システム
 *
 * Edit/MultiEdit実行前のファイル検証ビジネスロジック
 * - 類似ファイル名の検知
 * - Git履歴からユーザー作業ファイル特定
 * - 修正内容との関連性チェック
 * - 間違いやすいパターンの検知と警告
 */

import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";

import type { FileAnalysis } from "../../../../src/types/claude-hooks";

/**
 * ファイル検証クラス
 */
export class FileVerifier {
  /**
   * ファイル名の類似度を計算（レーベンシュタイン距離）
   */
  private calculateSimilarity(str1: string, str2: string): number {
    const len1 = str1.length;
    const len2 = str2.length;
    const dp: number[][] = Array(len1 + 1)
      .fill(null)
      .map(() => Array(len2 + 1).fill(0));

    for (let i = 0; i <= len1; i++) dp[i][0] = i;
    for (let j = 0; j <= len2; j++) dp[0][j] = j;

    for (let i = 1; i <= len1; i++) {
      for (let j = 1; j <= len2; j++) {
        const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
        dp[i][j] = Math.min(
          dp[i - 1][j] + 1, // 削除
          dp[i][j - 1] + 1, // 挿入
          dp[i - 1][j - 1] + cost, // 置換
        );
      }
    }

    const maxLen = Math.max(len1, len2);
    return maxLen === 0 ? 1 : 1 - dp[len1][len2] / maxLen;
  }

  /**
   * Git履歴から最近の活動を分析
   */
  private analyzeGitActivity(filePath: string): {
    activity: number;
    recentChanges: string[];
  } {
    try {
      // 過去7日間の変更回数を取得
      const changeCount = execSync(
        `git log --since="7 days ago" --oneline -- "${filePath}" 2>/dev/null | wc -l`,
        { encoding: "utf8" },
      ).trim();

      // 最近の変更内容を取得（最大3件）
      const recentChanges = execSync(
        `git log --since="7 days ago" --pretty=format:"%s" -n 3 -- "${filePath}" 2>/dev/null`,
        { encoding: "utf8" },
      )
        .trim()
        .split("\n")
        .filter(Boolean);

      return {
        activity: parseInt(changeCount) || 0,
        recentChanges,
      };
    } catch {
      return { activity: 0, recentChanges: [] };
    }
  }

  /**
   * ユーザーが最近開いた/編集したファイルを取得
   */
  private getRecentUserActivity(): string[] {
    try {
      // 最近のGitステータスとdiffから推測
      const stagedFiles = execSync(
        "git diff --cached --name-only 2>/dev/null",
        {
          encoding: "utf8",
        },
      )
        .trim()
        .split("\n")
        .filter(Boolean);

      const modifiedFiles = execSync("git diff --name-only 2>/dev/null", {
        encoding: "utf8",
      })
        .trim()
        .split("\n")
        .filter(Boolean);

      // 最近のコミットから作業ファイルを推測
      const recentCommitFiles = execSync(
        'git log --since="1 hour ago" --name-only --pretty=format: 2>/dev/null | sort -u',
        { encoding: "utf8" },
      )
        .trim()
        .split("\n")
        .filter(Boolean);

      return [
        ...new Set([...stagedFiles, ...modifiedFiles, ...recentCommitFiles]),
      ];
    } catch {
      return [];
    }
  }

  /**
   * 類似ファイルを検索
   */
  private findSimilarFiles(targetFile: string): string[] {
    const targetBase = path.basename(targetFile);
    const targetName = targetBase.replace(/\.[^.]+$/, ""); // 拡張子を除去
    const targetExt = path.extname(targetFile);

    try {
      // 同じ拡張子のファイルを検索
      const allFiles = execSync(
        `find . -type f -name "*${targetExt}" ! -path "./node_modules/*" ! -path "./.git/*" ! -path "./dist/*" ! -path "./build/*" 2>/dev/null`,
        { encoding: "utf8" },
      )
        .trim()
        .split("\n")
        .filter(Boolean);

      // 類似度でフィルタリング（閾値: 0.5以上）
      const similarFiles = allFiles
        .filter((file) => file !== `./${targetFile}`)
        .map((file) => ({
          file: file.replace(/^\.\//, ""),
          similarity: this.calculateSimilarity(
            path.basename(file).replace(/\.[^.]+$/, ""),
            targetName,
          ),
        }))
        .filter((item) => item.similarity > 0.5)
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, 10) // 上位10件まで
        .map((item) => item.file);

      return similarFiles;
    } catch {
      return [];
    }
  }

  /**
   * ファイルを総合的に分析
   */
  private analyzeFile(
    filePath: string,
    targetFile: string,
    recentUserFiles: string[],
  ): FileAnalysis {
    if (!fs.existsSync(filePath)) {
      throw new Error(`ファイルが存在しません: ${filePath}`);
    }

    const stats = fs.statSync(filePath);
    const gitInfo = this.analyzeGitActivity(filePath);

    // スコア計算
    const gitActivity = Math.min(gitInfo.activity * 2, 10); // 最大10点
    const userActivity = recentUserFiles.includes(filePath) ? 10 : 0;
    const similarityScore =
      this.calculateSimilarity(
        path.basename(filePath),
        path.basename(targetFile),
      ) * 10;

    // 内容関連性（ディレクトリの近さで判定）
    const targetDir = path.dirname(targetFile);
    const fileDir = path.dirname(filePath);
    const dirSimilarity = this.calculateSimilarity(targetDir, fileDir);
    const contentRelevance = dirSimilarity * 10;

    const totalScore =
      gitActivity + userActivity + similarityScore + contentRelevance;

    return {
      file: filePath,
      gitActivity,
      userActivity,
      similarityScore,
      contentRelevance,
      totalScore,
      size: stats.size,
      lastModified: stats.mtime,
      recentChanges: gitInfo.recentChanges,
    };
  }

  /**
   * 最適なファイルを推奨
   */
  private recommendBestFile(
    targetFile: string,
    editContent?: string,
  ): {
    recommendation: string;
    reason: string;
    shouldSwitch: boolean;
    alternatives: FileAnalysis[];
  } {
    try {
      const recentUserFiles = this.getRecentUserActivity();
      const similarFiles = this.findSimilarFiles(targetFile);

      if (similarFiles.length === 0) {
        return {
          recommendation: targetFile,
          reason: "類似ファイルが見つかりません",
          shouldSwitch: false,
          alternatives: [],
        };
      }

      // 全ファイルを分析
      const targetAnalysis = this.analyzeFile(
        targetFile,
        targetFile,
        recentUserFiles,
      );
      const similarAnalyses = similarFiles
        .map((file) => {
          try {
            return this.analyzeFile(file, targetFile, recentUserFiles);
          } catch {
            return null;
          }
        })
        .filter((a): a is FileAnalysis => a !== null);

      // スコアでソート
      const allAnalyses = [targetAnalysis, ...similarAnalyses].sort(
        (a, b) => b.totalScore - a.totalScore,
      );

      const bestFile = allAnalyses[0];
      const alternatives = allAnalyses.slice(1, 4); // 上位3件の代替案

      // 推奨判定
      if (
        bestFile.file !== targetFile &&
        bestFile.totalScore > targetAnalysis.totalScore * 1.5
      ) {
        // 1.5倍以上のスコア差がある場合のみ推奨
        let reasons = [];

        if (bestFile.gitActivity > targetAnalysis.gitActivity) {
          reasons.push(
            `最近の変更が多い（${bestFile.recentChanges.length}件）`,
          );
        }
        if (bestFile.userActivity > targetAnalysis.userActivity) {
          reasons.push("最近作業したファイル");
        }
        if (bestFile.similarityScore > targetAnalysis.similarityScore * 1.2) {
          reasons.push("ファイル名がより類似");
        }

        return {
          recommendation: bestFile.file,
          reason: reasons.join("、"),
          shouldSwitch: true,
          alternatives,
        };
      }

      return {
        recommendation: targetFile,
        reason: "編集対象ファイルが最適です",
        shouldSwitch: false,
        alternatives,
      };
    } catch (error) {
      console.error("ファイル推奨エラー:", error);
      return {
        recommendation: targetFile,
        reason: "エラーが発生しました",
        shouldSwitch: false,
        alternatives: [],
      };
    }
  }

  /**
   * メイン検証処理
   */
  public verify(toolInput: string): void {
    try {
      // tool inputからfile_pathと編集内容を抽出
      const filePathMatch = toolInput.match(/"file_path"\s*:\s*"([^"]+)"/);
      if (!filePathMatch) {
        return;
      }

      const targetFile = filePathMatch[1];
      const oldStringMatch = toolInput.match(/"old_string"\s*:\s*"([^"]+)"/);
      const editContent = oldStringMatch ? oldStringMatch[1] : undefined;

      // 検証実行
      console.log("🔍 Pre-Edit ファイル検証実行");
      console.log(`編集対象: ${targetFile}`);

      const recommendation = this.recommendBestFile(targetFile, editContent);

      console.log("📊 検証結果:");
      console.log(`推奨ファイル: ${recommendation.recommendation}`);
      console.log(`理由: ${recommendation.reason}`);

      if (recommendation.shouldSwitch) {
        console.log("⚠️  警告: より適切なファイルが見つかりました");
        console.log(
          `💡 推奨: ${recommendation.recommendation} を編集してください`,
        );
        console.log("");

        // 代替案の表示
        if (recommendation.alternatives.length > 0) {
          console.log("📋 その他の候補:");
          recommendation.alternatives.slice(0, 3).forEach((alt, index) => {
            console.log(`  ${index + 1}. ${alt.file}`);
            console.log(`     スコア: ${alt.totalScore.toFixed(1)}`);
            if (alt.recentChanges.length > 0) {
              console.log(`     最近の変更: ${alt.recentChanges[0]}`);
            }
          });
        }
      } else {
        // ユーザーの最近の活動を確認
        const recentFiles = this.getRecentUserActivity();
        if (recentFiles.length > 0 && !recentFiles.includes(targetFile)) {
          console.log("💡 ヒント: 最近作業したファイル:");
          recentFiles.slice(0, 3).forEach((file) => {
            console.log(`  - ${file}`);
          });
        }
      }
    } catch (error) {
      console.error("❌ Pre-Edit検証エラー:", error);
    }
  }
}
