#!/usr/bin/env node
/**
 * Commit Refactoring History to Base Branch
 *
 * PR作成後、refactoring-result.json をもとに refactoring-history.json を更新し、
 * baseブランチ（デフォルト: main）へ直接コミットする。
 *
 * 目的:
 * - PRをマージしなくても、次回Runが最新の履歴を参照できるようにする
 * - PRに履歴ファイルを含めて add/add 競合するのを避ける
 *
 * Usage:
 *   PR_NUMBER=123 PR_BRANCH=ops-department/auto-refactor-999 TARGET_BRANCH=main node scripts/commit-history-to-develop.cjs
 */

const { execSync } = require("child_process");
const fs = require("fs");

const HISTORY_FILE = "refactoring-history.json";
const RESULT_FILE = "refactoring-result.json";

function getRepoSlug() {
  const fromEnv = process.env.GITHUB_REPOSITORY;
  if (fromEnv) return fromEnv;

  try {
    const url = execSync("git remote get-url origin", {
      encoding: "utf-8",
    }).trim();
    const match = url.match(/github\.com[:/](.+?)\/(.+?)(?:\.git)?$/);
    if (match) return `${match[1]}/${match[2]}`;
  } catch (_error) {
    // ignore
  }

  return "Unson-LLC/brainbase";
}

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
    return { areas: [], last_updated: null };
  }

  try {
    const content = fs.readFileSync(HISTORY_FILE, "utf-8");
    return JSON.parse(content);
  } catch (error) {
    console.error("❌ 履歴ファイル読み込み失敗:", error.message);
    process.exit(1);
  }
}

function loadRefactoringResult() {
  if (!fs.existsSync(RESULT_FILE)) {
    console.error(`❌ ${RESULT_FILE} が見つかりません`);
    process.exit(1);
  }

  try {
    const content = fs.readFileSync(RESULT_FILE, "utf-8");
    return JSON.parse(content);
  } catch (error) {
    console.error(
      "❌ リファクタリング結果ファイル読み込み失敗:",
      error.message,
    );
    process.exit(1);
  }
}

function upsertHistoryEntry(history, entry) {
  const entryRunNumber = entry.run_number;

  const idx = history.areas.findIndex((a) => {
    if (a.area !== entry.area) return false;
    if (entryRunNumber) return a.run_number === entryRunNumber;
    return a.refactored_at === entry.refactored_at;
  });

  if (idx >= 0) {
    history.areas[idx] = { ...history.areas[idx], ...entry };
    return { updated: true };
  }

  history.areas.push(entry);
  return { updated: false };
}

function main() {
  console.log("🔄 Committing refactoring history to base branch...");
  console.log("=".repeat(60));

  const prNumber = process.env.PR_NUMBER;
  if (!prNumber) {
    console.error("❌ 環境変数 PR_NUMBER が設定されていません");
    process.exit(1);
  }

  const targetBranch = process.env.TARGET_BRANCH || "main";
  const repoSlug = getRepoSlug();

  const prBranch =
    process.env.PR_BRANCH ||
    execSync("git rev-parse --abbrev-ref HEAD", { encoding: "utf-8" }).trim();

  console.log(`  PR Number: ${prNumber}`);
  console.log(`  PR branch: ${prBranch}`);
  console.log(`  Target branch: ${targetBranch}`);
  console.log(`  Repo: ${repoSlug}`);

  const refactoringResult = loadRefactoringResult();
  console.log(`  📦 Loaded refactoring result: ${refactoringResult.area}`);

  // baseブランチで履歴を更新
  console.log(`\n  🔀 Switching to ${targetBranch} branch...`);
  try {
    checkoutOriginBranch(targetBranch);
  } catch (error) {
    console.error(`❌ ${targetBranch}切り替え失敗:`, error.message);
    process.exit(1);
  }

  const history = loadRefactoringHistory();
  if (!Array.isArray(history.areas)) history.areas = [];

  const entry = {
    area: refactoringResult.area,
    refactored_at: refactoringResult.refactored_at || new Date().toISOString(),
    files_modified: refactoringResult.files_modified || [],
    changes_summary: refactoringResult.changes_summary || "",
    tier: refactoringResult.tier || null,
    hotspot_since_days: refactoringResult.hotspot_since_days ?? null,
    hotspot_score: refactoringResult.hotspot_score ?? null,
    cooldown_days: refactoringResult.cooldown_days ?? null,
    refactor_timeout_ms: refactoringResult.refactor_timeout_ms ?? null,
    judge_score: refactoringResult.judge_score ?? null,
    judge_threshold: refactoringResult.judge_threshold ?? null,
    judge_summary: refactoringResult.judge_summary || "",
    judge_must_fix: refactoringResult.judge_must_fix || [],
    judge_suggestions: refactoringResult.judge_suggestions || [],
    run_number:
      refactoringResult.run_number || process.env.GITHUB_RUN_NUMBER || null,
    run_id: refactoringResult.run_id || process.env.GITHUB_RUN_ID || null,
    trigger_event:
      refactoringResult.trigger_event || process.env.GITHUB_EVENT_NAME || null,
    pr_number: parseInt(prNumber, 10),
    pr_branch: prBranch,
    pr_url: `https://github.com/${repoSlug}/pull/${prNumber}`,
    pr_status: "open",
    merged_at: null,
  };

  const { updated } = upsertHistoryEntry(history, entry);
  console.log(
    updated
      ? `  ✅ Updated existing history entry: ${entry.area}`
      : `  ✅ Added new history entry: ${entry.area}`,
  );

  history.total_prs_created =
    (history.total_prs_created || 0) + (updated ? 0 : 1);
  history.last_updated = new Date().toISOString();

  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
  console.log(`  💾 Saved updated history (${HISTORY_FILE})`);

  // commit & push
  console.log(`\n  📝 Committing history to ${targetBranch}...`);
  ensureGitUserConfig();

  try {
    execSync(`git add ${HISTORY_FILE}`);

    try {
      execSync("git diff --cached --quiet", { stdio: "ignore" });
      console.log("  ℹ️  No changes to commit");
      return;
    } catch (_error) {
      // changes exist
    }

    execSync(
      `git commit -m "chore: update refactoring history (Run ${process.env.GITHUB_RUN_NUMBER}, PR #${prNumber})"`,
      { encoding: "utf-8" },
    );
  } catch (error) {
    console.error("❌ コミット失敗:", error.message);
    process.exit(1);
  }

  console.log(`\n  🚀 Pushing to origin/${targetBranch}...`);
  try {
    execSync(`git push origin "${targetBranch}"`, { stdio: "inherit" });
    console.log(`  ✅ Pushed to ${targetBranch}`);
  } catch (error) {
    console.error("❌ プッシュ失敗:", error.message);
    process.exit(1);
  }

  console.log("\n" + "=".repeat(60));
  console.log(`🎉 Refactoring history committed to ${targetBranch}!`);
}

main();
