#!/usr/bin/env node
/**
 * ops-department Auto Refactoring Script
 *
 * Self-hosted GitHub ActionsランナーでClaude CLIを使用して
 * refactoring-specialist が未リファクタリング領域を特定し、
 * 実際にコードを修正してPR作成する。
 *
 * 実行タイミング: 6時間ごと (0:00, 6:00, 12:00, 18:00 UTC)
 * 実行環境: GitHub Actions (self-hosted runner)
 *
 * 戦略:
 * 1. リファクタリング履歴を読み込み（refactoring-history.json）
 * 2. コードベースをスキャンして未リファクタリング領域を特定
 * 3. refactoring-specialist が実際にコードを修正
 * 4. 履歴を更新してPR作成
 *
 * Usage:
 *   node scripts/ops-team-review.js [--dry-run]
 */

const { spawn, execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

// リファクタリング履歴ファイル
const HISTORY_FILE = "refactoring-history.json";

// refactoring-specialist 設定
const REFACTORING_SPECIALIST = {
  model: "claude-opus-4-6",
  role: "Refactoring Specialist - Implements actual code improvements",
  skills: [
    "refactoring-workflow",
    "verify-first-debugging",
    "architecture-patterns",
  ],
  systemPrompt: `You are the Refactoring Specialist in the ops-department.

Your role: Identify and IMPLEMENT actual refactoring improvements in the codebase.

Skills you have access to:
- refactoring-workflow: 3-Phase段階的移行、既存機能保護
- verify-first-debugging: 証拠階層で検証→仮説禁止→根本原因修正
- architecture-patterns: EventBus/DI/Reactive/Service準拠チェック

IMPORTANT: You must ACTUALLY MODIFY the code files, not just suggest improvements.

Refactoring priorities:
1. Code duplication (DRY violations)
2. Complex functions (>50 lines, high cyclomatic complexity)
3. Poor naming (unclear variable/function names)
4. Missing error handling
5. Architecture pattern violations

For each file you review:
1. Identify concrete refactoring opportunities
2. IMPLEMENT the changes directly in the code
3. Ensure backward compatibility
4. Provide a summary of changes made

Output format:
{
  "refactored": true/false,
  "files_modified": ["path/to/file1.ts", "path/to/file2.ts"],
  "changes_summary": "Description of refactoring applied",
  "area": "Component/Module name (e.g., 'Authentication', 'API Handlers', 'UI Components')"
}`,
};

/**
 * Claude CLIを使用してテキスト生成
 */
async function generateWithClaude(systemPrompt, userPrompt, options = {}) {
  const { timeout = 300000 } = options;

  const homeDir = process.env.HOME || require("os").homedir();

  console.log(`[Claude CLI] 実行開始 (HOME=${homeDir})`);

  return new Promise((resolve, reject) => {
    const args = [
      "@anthropic-ai/claude-code",
      "--print",
      "--dangerously-skip-permissions",
      "--system-prompt",
      systemPrompt,
      userPrompt,
    ];

    const child = spawn("npx", args, {
      env: {
        ...process.env,
        HOME: homeDir,
        CLAUDE_CODE_DISABLE_TELEMETRY: "1",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    child.stdin.end();

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    const timer = setTimeout(() => {
      console.error(`[Claude CLI] タイムアウト (${timeout}ms)`);
      child.kill("SIGTERM");
      reject(new Error(`Claude CLI timed out after ${timeout}ms`));
    }, timeout);

    child.on("close", (code) => {
      clearTimeout(timer);

      if (code !== 0) {
        reject(
          new Error(
            `Claude CLI exited with code ${code}: ${stderr || stdout.substring(0, 200)}`,
          ),
        );
        return;
      }

      resolve(stdout.trim());
    });

    child.on("error", (error) => {
      clearTimeout(timer);
      reject(new Error(`Claude CLI spawn failed: ${error.message}`));
    });
  });
}

/**
 * リファクタリング履歴を読み込み
 */
function loadRefactoringHistory() {
  if (!fs.existsSync(HISTORY_FILE)) {
    return { areas: [], last_updated: null };
  }

  try {
    const content = fs.readFileSync(HISTORY_FILE, "utf-8");
    return JSON.parse(content);
  } catch (error) {
    console.warn("履歴ファイル読み込み失敗:", error.message);
    return { areas: [], last_updated: null };
  }
}

/**
 * リファクタリング履歴を保存
 */
function saveRefactoringHistory(history) {
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
  console.log(`✅ 履歴を更新: ${HISTORY_FILE}`);
}

/**
 * コードベースをスキャンして領域リストを作成
 */
function scanCodebase() {
  const srcDirs = ["public/modules", "server/controllers", "server/services", "lib"];
  const areas = new Set();

  srcDirs.forEach((dir) => {
    if (!fs.existsSync(dir)) return;

    const files = execSync(`find ${dir} -name "*.ts" -o -name "*.tsx" -o -name "*.js"`, {
      encoding: "utf-8",
    })
      .trim()
      .split("\n")
      .filter(Boolean);

    files.forEach((file) => {
      // ディレクトリ名を領域として抽出 (例: "public/modules/auth" → "public/modules/auth")
      const parts = file.split("/");
      if (parts.length > 1) {
        const area = parts.slice(0, -1).join("/"); // ファイル名を除外
        areas.add(area);
      }
    });
  });

  return Array.from(areas).sort();
}

/**
 * 未リファクタリング領域を特定
 */
function findUnrefactoredAreas(allAreas, history) {
  const refactoredAreas = new Set(history.areas.map((entry) => entry.area));
  return allAreas.filter((area) => !refactoredAreas.has(area));
}

/**
 * 領域のファイル一覧を取得
 */
function getFilesInArea(area) {
  try {
    const pattern = `${area}/**/*.{ts,tsx,js}`;
    const files = execSync(`find ${area} -name "*.ts" -o -name "*.tsx" -o -name "*.js"`, {
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024,
    })
      .trim()
      .split("\n")
      .filter(Boolean);
    return files;
  } catch (error) {
    console.warn(`領域 ${area} のファイル取得失敗:`, error.message);
    return [];
  }
}

/**
 * ファイルの内容を取得
 */
function getFileContent(filePath) {
  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch (error) {
    console.warn(`ファイル読み込み失敗 (${filePath}):`, error.message);
    return "";
  }
}

/**
 * refactoring-specialistによるリファクタリング実行
 */
async function refactorArea(area, files) {
  console.log(`\n🔨 Refactoring area: ${area}`);
  console.log(`  📁 Files: ${files.length}`);

  if (files.length === 0) {
    return null;
  }

  // ファイル内容を取得（最大5ファイルまで）
  const filesToRefactor = files.slice(0, 5);
  const fileContents = filesToRefactor.map((file) => ({
    path: file,
    content: getFileContent(file),
  }));

  const userPrompt = `以下の領域のコードをリファクタリングしてください:

領域: ${area}

ファイル:
${fileContents
  .map(
    (f) => `
--- ${f.path} ---
${f.content.substring(0, 10000)}
`,
  )
  .join("\n")}

上記のコードを分析し、以下を実行してください:
1. リファクタリング機会を特定
2. 実際にコードを改善（重複削除、命名改善、複雑度削減）
3. 変更内容をJSON形式で出力

IMPORTANT: Editツールを使って実際にファイルを修正してください！

出力形式:
{
  "refactored": true/false,
  "files_modified": ["path/to/file"],
  "changes_summary": "変更内容の説明",
  "area": "${area}"
}`;

  try {
    const result = await generateWithClaude(
      REFACTORING_SPECIALIST.systemPrompt,
      userPrompt,
      { timeout: 600000 }, // 10分タイムアウト
    );

    // JSON抽出
    let jsonStr = result;
    const jsonMatch = result.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1];
    }

    const refactoringResult = JSON.parse(jsonStr.trim());
    console.log(`  ✅ Refactoring completed`);
    console.log(`  📝 ${refactoringResult.changes_summary}`);

    return refactoringResult;
  } catch (error) {
    console.error(`  ❌ Refactoring failed:`, error.message);
    return null;
  }
}

/**
 * メイン処理
 */
async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");

  console.log("🤖 ops-department Auto Refactoring Starting...");
  console.log("=".repeat(60));
  console.log(`Mode: ${dryRun ? "DRY RUN" : "PRODUCTION"}`);
  console.log("=".repeat(60));

  // 1. 履歴読み込み
  console.log("\n📖 Loading refactoring history...");
  const history = loadRefactoringHistory();
  console.log(`  ✅ ${history.areas.length} areas already refactored`);

  // 2. コードベーススキャン
  console.log("\n🔍 Scanning codebase...");
  const allAreas = scanCodebase();
  console.log(`  ✅ Found ${allAreas.length} total areas`);

  // 3. 未リファクタリング領域を特定
  const unrefactoredAreas = findUnrefactoredAreas(allAreas, history);
  console.log(`  ✅ ${unrefactoredAreas.length} areas not yet refactored`);

  if (unrefactoredAreas.length === 0) {
    console.log("\n🎉 All areas have been refactored!");
    return;
  }

  // 4. 最初の未リファクタリング領域をリファクタリング
  const targetArea = unrefactoredAreas[0];
  const files = getFilesInArea(targetArea);

  console.log(`\n🎯 Target area: ${targetArea}`);

  const refactoringResult = await refactorArea(targetArea, files);

  if (!refactoringResult || !refactoringResult.refactored) {
    console.log("\n❌ No refactoring was performed");
    return;
  }

  // 5. 履歴を更新
  if (!dryRun) {
    history.areas.push({
      area: refactoringResult.area,
      refactored_at: new Date().toISOString(),
      files_modified: refactoringResult.files_modified,
      changes_summary: refactoringResult.changes_summary,
    });
    history.last_updated = new Date().toISOString();
    saveRefactoringHistory(history);

    // 履歴ファイルをgit add
    execSync(`git add ${HISTORY_FILE}`);
  }

  // 6. レポート生成
  console.log("\n📄 Generating refactoring report...");
  const report = `# ops-department Auto Refactoring Report

Generated: ${new Date().toISOString()}

## Refactored Area

**${refactoringResult.area}**

## Changes Summary

${refactoringResult.changes_summary}

## Files Modified

${refactoringResult.files_modified.map((f) => `- ${f}`).join("\n")}

## Progress

- Total areas: ${allAreas.length}
- Already refactored: ${history.areas.length}
- Remaining: ${unrefactoredAreas.length - 1}

---

This refactoring was automatically performed by the ops-department refactoring-specialist.
`;

  const reportPath = "ops-department-refactoring.md";
  fs.writeFileSync(reportPath, report);
  console.log(`✅ Report saved to ${reportPath}`);

  console.log("\n" + "=".repeat(60));
  console.log("🎉 ops-department Auto Refactoring Complete!");
}

main().catch((error) => {
  console.error("❌ Fatal error:", error);
  process.exit(1);
});
