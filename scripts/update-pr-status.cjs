#!/usr/bin/env node
/**
 * Update PR Merge Status in Refactoring History
 *
 * 定期的にPRのマージ状態を確認し、履歴を更新する。
 * マージ済みPRの情報を履歴に反映させることで、進捗を追跡できる。
 *
 * Usage:
 *   node scripts/update-pr-status.cjs
 */

const { execSync } = require("child_process");
const fs = require("fs");

const HISTORY_FILE = "refactoring-history.json";

/**
 * リファクタリング履歴を読み込み
 */
function loadRefactoringHistory() {
  if (!fs.existsSync(HISTORY_FILE)) {
    console.log(`⚠️  ${HISTORY_FILE} が見つかりません。スキップします。`);
    return null;
  }

  try {
    const content = fs.readFileSync(HISTORY_FILE, "utf-8");
    return JSON.parse(content);
  } catch (error) {
    console.error("❌ 履歴ファイル読み込み失敗:", error.message);
    return null;
  }
}

/**
 * 履歴を保存
 */
function saveRefactoringHistory(history) {
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
}

/**
 * PRステータスを取得
 */
function getPRStatus(prNumber) {
  try {
    const result = execSync(
      `gh pr view ${prNumber} --json state,mergedAt --jq '.state,.mergedAt'`,
      { encoding: "utf-8" }
    ).trim();

    const [state, mergedAt] = result.split("\n");

    return {
      state,
      mergedAt: mergedAt === "null" ? null : mergedAt,
    };
  } catch (error) {
    console.warn(`⚠️  PR #${prNumber} のステータス取得失敗:`, error.message);
    return null;
  }
}

/**
 * メイン処理
 */
function main() {
  console.log("🔄 Updating PR merge status...");
  console.log("=".repeat(60));

  // 履歴を読み込み
  const history = loadRefactoringHistory();
  if (!history) {
    console.log("✅ No history to update");
    return;
  }

  console.log(`  📖 Loaded history: ${history.areas.length} areas`);

  let updatedCount = 0;
  let mergedCount = 0;

  // 各エントリのPRステータスを確認
  for (const area of history.areas) {
    // PR情報がない、またはすでにマージ済みの場合はスキップ
    if (!area.pr_number || area.pr_status === "merged") {
      continue;
    }

    console.log(`\n  🔍 Checking PR #${area.pr_number} (${area.area})...`);

    const prStatus = getPRStatus(area.pr_number);
    if (!prStatus) {
      continue;
    }

    // ステータスが変更されている場合は更新
    if (prStatus.state === "MERGED" && area.pr_status !== "merged") {
      area.pr_status = "merged";
      area.merged_at = prStatus.mergedAt || new Date().toISOString();
      console.log(`    ✅ Marked as MERGED (${area.merged_at})`);
      updatedCount++;
      mergedCount++;
    } else if (prStatus.state === "CLOSED" && area.pr_status !== "closed") {
      area.pr_status = "closed";
      console.log(`    ⚠️  Marked as CLOSED`);
      updatedCount++;
    } else {
      console.log(`    ℹ️  Status unchanged: ${area.pr_status}`);
    }
  }

  // 統計情報を更新
  if (updatedCount > 0) {
    history.total_prs_merged = (history.total_prs_merged || 0) + mergedCount;
    history.last_updated = new Date().toISOString();

    // 履歴を保存
    saveRefactoringHistory(history);
    console.log(`\n  💾 Saved updated history`);

    // developにコミット・プッシュ
    console.log("\n  📝 Committing to develop...");
    try {
      execSync(`git add ${HISTORY_FILE}`);
      execSync(
        `git commit -m "chore: update PR status (${updatedCount} updated, ${mergedCount} merged)"`,
        { encoding: "utf-8" }
      );
      execSync("git push origin develop");
      console.log("  ✅ Pushed to develop");
    } catch (error) {
      console.error("❌ コミット・プッシュ失敗:", error.message);
      process.exit(1);
    }
  } else {
    console.log("\n  ℹ️  No status changes detected");
  }

  console.log("\n" + "=".repeat(60));
  console.log(`🎉 PR status update complete! (${updatedCount} updated)`);
}

main();
