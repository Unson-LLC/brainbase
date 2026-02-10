#!/usr/bin/env node
/**
 * Commit Refactoring History to Develop Branch
 *
 * PR作成後、リファクタリング履歴をdevelopブランチに直接コミットする。
 * これにより、次のRunで前回の履歴を参照できるようになる。
 *
 * Usage:
 *   PR_NUMBER=123 node scripts/commit-history-to-develop.cjs
 */

const { execSync } = require("child_process");
const fs = require("fs");

const HISTORY_FILE = "refactoring-history.json";

/**
 * リファクタリング履歴を読み込み
 */
function loadRefactoringHistory() {
  if (!fs.existsSync(HISTORY_FILE)) {
    console.error(`❌ ${HISTORY_FILE} が見つかりません`);
    process.exit(1);
  }

  try {
    const content = fs.readFileSync(HISTORY_FILE, "utf-8");
    return JSON.parse(content);
  } catch (error) {
    console.error("❌ 履歴ファイル読み込み失敗:", error.message);
    process.exit(1);
  }
}

/**
 * メイン処理
 */
function main() {
  console.log("🔄 Committing refactoring history to develop branch...");
  console.log("=".repeat(60));

  // 環境変数からPR番号を取得
  const prNumber = process.env.PR_NUMBER;
  if (!prNumber) {
    console.error("❌ 環境変数 PR_NUMBER が設定されていません");
    process.exit(1);
  }

  console.log(`  PR Number: ${prNumber}`);

  // 現在のブランチを確認
  const currentBranch = execSync("git branch --show-current", {
    encoding: "utf-8",
  }).trim();
  console.log(`  Current branch: ${currentBranch}`);

  // 履歴を読み込み
  const history = loadRefactoringHistory();
  console.log(`  📖 Loaded history: ${history.areas.length} areas`);

  // 最新のエントリにPR情報を追加
  if (history.areas.length > 0) {
    const latestArea = history.areas[history.areas.length - 1];

    // PR情報を追加
    latestArea.pr_number = parseInt(prNumber);
    latestArea.pr_branch = currentBranch;
    latestArea.pr_url = `https://github.com/Unson-LLC/salestailor/pull/${prNumber}`;
    latestArea.pr_status = "open";
    latestArea.merged_at = null;
    latestArea.run_number = parseInt(process.env.GITHUB_RUN_NUMBER || "0");

    console.log(`  ✅ Added PR info to latest area: ${latestArea.area}`);
  }

  // 統計情報を更新
  history.total_prs_created = (history.total_prs_created || 0) + 1;
  history.last_updated = new Date().toISOString();

  // 履歴を保存
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
  console.log(`  💾 Saved updated history`);

  // developブランチに切り替え
  console.log("\n  🔀 Switching to develop branch...");
  try {
    execSync("git fetch origin develop");
    execSync("git checkout develop");
    execSync("git pull origin develop");
    console.log("  ✅ Switched to develop and pulled latest");
  } catch (error) {
    console.error("❌ develop切り替え失敗:", error.message);
    process.exit(1);
  }

  // 履歴ファイルをdevelopにコミット
  console.log("\n  📝 Committing history to develop...");
  try {
    execSync(`git add ${HISTORY_FILE}`);
    execSync(
      `git commit -m "chore: update refactoring history (Run ${process.env.GITHUB_RUN_NUMBER}, PR #${prNumber})"`,
      { encoding: "utf-8" }
    );
    console.log("  ✅ Committed to develop");
  } catch (error) {
    console.error("❌ コミット失敗:", error.message);
    process.exit(1);
  }

  // developにプッシュ
  console.log("\n  🚀 Pushing to origin/develop...");
  try {
    execSync("git push origin develop");
    console.log("  ✅ Pushed to develop");
  } catch (error) {
    console.error("❌ プッシュ失敗:", error.message);
    process.exit(1);
  }

  // 元のブランチに戻る
  console.log(`\n  🔙 Returning to ${currentBranch}...`);
  try {
    execSync(`git checkout ${currentBranch}`);
    console.log(`  ✅ Returned to ${currentBranch}`);
  } catch (error) {
    console.warn("⚠️  元のブランチに戻れませんでした:", error.message);
  }

  console.log("\n" + "=".repeat(60));
  console.log("🎉 Refactoring history committed to develop!");
}

main();
