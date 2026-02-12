#!/usr/bin/env node
/**
 * Update PR Merge Status in Refactoring History
 *
 * 定期的にPRのマージ状態を確認し、refactoring-history.json を更新してbaseブランチに反映する。
 *
 * Usage:
 *   TARGET_BRANCH=main node scripts/update-pr-status.cjs
 */

const { execSync } = require("child_process");
const fs = require("fs");

const HISTORY_FILE = "refactoring-history.json";

function ensureGitUserConfig() {
  try {
    const name = execSync("git config --get user.name || true", {
      encoding: "utf-8",
    }).trim();
    const email = execSync("git config --get user.email || true", {
      encoding: "utf-8",
    }).trim();

    if (!name) execSync('git config user.name "github-actions[bot]"');
    if (!email)
      execSync(
        'git config user.email "github-actions[bot]@users.noreply.github.com"',
      );
  } catch (_error) {
    // Best-effort
  }
}

function checkoutOriginBranch(branch) {
  execSync(`git fetch origin "${branch}"`, { stdio: "inherit" });
  execSync(`git checkout -B "${branch}" "origin/${branch}"`, {
    stdio: "inherit",
  });
  execSync(`git pull origin "${branch}"`, { stdio: "inherit" });
}

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

function saveRefactoringHistory(history) {
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
}

function getPRStatus(prNumber) {
  try {
    const result = execSync(
      `gh pr view ${prNumber} --json state,mergedAt --jq '.state,.mergedAt'`,
      { encoding: "utf-8" },
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

function main() {
  console.log("🔄 Updating PR merge status...");
  console.log("=".repeat(60));

  const targetBranch = process.env.TARGET_BRANCH || "main";

  // 常にbaseブランチ上で履歴を更新する
  try {
    checkoutOriginBranch(targetBranch);
  } catch (error) {
    console.error(`❌ ${targetBranch} のチェックアウトに失敗:`, error.message);
    process.exit(1);
  }

  const history = loadRefactoringHistory();
  if (!history) {
    console.log("✅ No history to update");
    return;
  }

  if (!Array.isArray(history.areas)) history.areas = [];

  console.log(`  📖 Loaded history: ${history.areas.length} areas`);

  let updatedCount = 0;
  let mergedCount = 0;

  for (const area of history.areas) {
    if (!area.pr_number || area.pr_status === "merged") {
      continue;
    }

    console.log(`\n  🔍 Checking PR #${area.pr_number} (${area.area})...`);

    const prStatus = getPRStatus(area.pr_number);
    if (!prStatus) {
      continue;
    }

    if (prStatus.state === "MERGED" && area.pr_status !== "merged") {
      area.pr_status = "merged";
      area.merged_at = prStatus.mergedAt || new Date().toISOString();
      console.log(`    ✅ Marked as MERGED (${area.merged_at})`);
      updatedCount++;
      mergedCount++;
    } else if (prStatus.state === "CLOSED" && area.pr_status !== "closed") {
      area.pr_status = "closed";
      console.log("    ⚠️  Marked as CLOSED");
      updatedCount++;
    } else {
      console.log(`    ℹ️  Status unchanged: ${area.pr_status}`);
    }
  }

  if (updatedCount > 0) {
    history.total_prs_merged = (history.total_prs_merged || 0) + mergedCount;
    history.last_updated = new Date().toISOString();

    saveRefactoringHistory(history);
    console.log("\n  💾 Saved updated history");

    console.log(`\n  📝 Committing to ${targetBranch}...`);
    try {
      ensureGitUserConfig();
      execSync(`git add ${HISTORY_FILE}`);

      try {
        execSync("git diff --cached --quiet", { stdio: "ignore" });
        console.log("  ℹ️  No changes to commit");
        return;
      } catch (_error) {
        // changes exist
      }

      execSync(
        `git commit -m "chore: update PR status (${updatedCount} updated, ${mergedCount} merged)"`,
        { encoding: "utf-8" },
      );

      execSync(`git push origin "${targetBranch}"`, { stdio: "inherit" });
      console.log(`  ✅ Pushed to ${targetBranch}`);
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
