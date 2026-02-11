#!/usr/bin/env node
/**
 * ops-department Auto Refactoring Script
 *
 * Self-hosted GitHub ActionsランナーでAI CLI（Codex/Claude）を使用して
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
 *   node scripts/ops-team-review.cjs [--dry-run]
 */

const { spawn, execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

// リファクタリング履歴ファイル
const HISTORY_FILE = "refactoring-history.json";

// refactoring-specialist 設定
const REFACTORING_SPECIALIST = {
  model: process.env.CODEX_MODEL || process.env.AI_MODEL || "gpt-5-codex",
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
 * Codex CLIを使用してテキスト生成
 */
async function generateWithCodex(systemPrompt, userPrompt, options = {}) {
  const { timeout = 300000 } = options;
  const codexPath = process.env.CODEX_CLI_PATH || "codex";
  const reasoningEffort = process.env.CODEX_REASONING_EFFORT || "high";
  const homeDir = process.env.REAL_HOME || process.env.HOME || "/Users/ksato";
  const outputFilePath = path.join(
    process.cwd(),
    `.codex-last-message-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`,
  );
  const combinedPrompt = `${systemPrompt}\n\nUser Request:\n${userPrompt}`;

  console.log(
    `[Codex CLI] 実行開始 (HOME=${homeDir}, model=${REFACTORING_SPECIALIST.model})`,
  );

  return new Promise((resolve, reject) => {
    const args = [
      "exec",
      "--dangerously-bypass-approvals-and-sandbox",
      "--skip-git-repo-check",
      "-c",
      `model_reasoning_effort="${reasoningEffort}"`,
      "--output-last-message",
      outputFilePath,
    ];
    if (REFACTORING_SPECIALIST.model) {
      args.push("--model", REFACTORING_SPECIALIST.model);
    }
    args.push("-");

    const child = spawn(codexPath, args, {
      env: {
        ...process.env,
        HOME: homeDir,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    child.stdin.write(combinedPrompt);
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
      console.error(`[Codex CLI] タイムアウト (${timeout}ms)`);
      child.kill("SIGTERM");
      reject(new Error(`Codex CLI timed out after ${timeout}ms`));
    }, timeout);

    child.on("close", (code) => {
      clearTimeout(timer);
      let lastMessage = "";

      try {
        if (fs.existsSync(outputFilePath)) {
          lastMessage = fs.readFileSync(outputFilePath, "utf-8").trim();
          fs.unlinkSync(outputFilePath);
        }
      } catch (readError) {
        console.warn(
          `[Codex CLI] 最終メッセージ読み込み失敗: ${readError.message}`,
        );
      }

      if (code !== 0) {
        reject(
          new Error(
            `Codex CLI exited with code ${code}: ${stderr || stdout.substring(0, 200)}`,
          ),
        );
        return;
      }

      resolve(lastMessage || stdout.trim());
    });

    child.on("error", (error) => {
      clearTimeout(timer);
      reject(new Error(`Codex CLI spawn failed: ${error.message}`));
    });
  });
}

/**
 * Claude CLIを使用してテキスト生成（フォールバック用）
 */
async function generateWithClaude(systemPrompt, userPrompt, options = {}) {
  const { timeout = 300000 } = options;
  const homeDir = process.env.REAL_HOME || process.env.HOME || "/Users/ksato";
  const rawClaudeCommand = (
    process.env.CLAUDE_CLI_COMMAND || "npx @anthropic-ai/claude-code"
  ).trim();
  const claudeCommandParts = rawClaudeCommand.split(/\s+/).filter(Boolean);
  const claudeCliCommand = claudeCommandParts[0];
  const claudeCliArgs = claudeCommandParts.slice(1);

  console.log(`[Claude CLI] 実行開始 (HOME=${homeDir})`);

  return new Promise((resolve, reject) => {
    const args = [
      ...claudeCliArgs,
      "--print",
      "--dangerously-skip-permissions",
      "--system-prompt",
      systemPrompt,
      userPrompt,
    ];

    const child = spawn(claudeCliCommand, args, {
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
 * AI CLIバックエンドを選択してテキスト生成
 */
async function generateWithAI(systemPrompt, userPrompt, options = {}) {
  const backend = (process.env.AI_CLI_BACKEND || "codex").toLowerCase();

  if (backend === "claude") {
    return generateWithClaude(systemPrompt, userPrompt, options);
  }

  if (backend !== "codex") {
    throw new Error(`Unsupported AI_CLI_BACKEND: ${backend}`);
  }

  return generateWithCodex(systemPrompt, userPrompt, options);
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
  // brainbase-unsonはTypeScript主体ではないため、git管理されているJS/TSファイルを対象にする。
  // "find" だと .gitignore のローカル専用ディレクトリまで拾う可能性があるので、
  // 必ず "git ls-files" で追跡対象のみをスキャンする。
  const srcDirs = ["public/modules", "server", "lib"];
  const areas = new Set();

  srcDirs.forEach((dir) => {
    if (!fs.existsSync(dir)) return;

    const files = execSync(`git ls-files "${dir}"`, {
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024,
    })
      .trim()
      .split("\n")
      .filter(Boolean);

    files
      .filter((file) => /\.(cjs|mjs|js|tsx?|jsx?)$/.test(file))
      .forEach((file) => {
        const area = path.dirname(file);
        if (area && area !== ".") areas.add(area);
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
    const files = execSync(`git ls-files "${area}"`, {
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024,
    })
      .trim()
      .split("\n")
      .filter(Boolean)
      .filter((file) => /\.(cjs|mjs|js|tsx?|jsx?)$/.test(file));

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
    const result = await generateWithAI(
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
 * git diff統計を取得
 */
function getFileStats(files) {
  try {
    const stats = files.map((file) => {
      let tracked = false;
      try {
        execSync(`git ls-files --error-unmatch "${file}" 2>/dev/null`, {
          stdio: "ignore",
        });
        tracked = true;
      } catch (_error) {
        tracked = false;
      }

      const diffCmd = tracked
        ? `git diff --numstat HEAD -- "${file}" 2>/dev/null || echo "0\t0\t${file}"`
        : `git diff --numstat --no-index -- /dev/null "${file}" 2>/dev/null || echo "0\t0\t${file}"`;

      const diffStat = execSync(diffCmd, { encoding: "utf-8" }).trim();

      const [added, deleted, path] = diffStat.split("\t");
      return {
        path: file,
        added: parseInt(added) || 0,
        deleted: parseInt(deleted) || 0,
        isNew: !tracked,
      };
    });
    return stats;
  } catch (error) {
    console.warn("git diff統計取得失敗:", error.message);
    return files.map(f => ({ path: f, added: 0, deleted: 0, isNew: false }));
  }
}

/**
 * 新規ファイル一覧を取得
 */
function getNewFiles(fileStats) {
  return fileStats.filter(f => f.isNew).map(f => f.path);
}

/**
 * 合計追加・削除行数を取得
 */
function getTotalLines(fileStats) {
  return fileStats.reduce(
    (acc, f) => ({
      added: acc.added + f.added,
      deleted: acc.deleted + f.deleted
    }),
    { added: 0, deleted: 0 }
  );
}

/**
 * PRタイトルを生成
 */
function generatePRTitle(metadata) {
  const { area, newFiles, codeReduction } = metadata;

  // 新規ファイルから主要なコンポーネント名を抽出
  const mainComponents = newFiles
    .map(f => path.basename(f, path.extname(f)))
    .filter(name => name.length > 0)
    .slice(0, 2)
    .join(", ");

  const reductionText = codeReduction > 0 ? ` - ${codeReduction}行削減` : "";
  const componentText = mainComponents ? ` - ${mainComponents}作成` : "";

  return `refactor(${area}): ${metadata.summaryShort}${componentText}${reductionText}`;
}

/**
 * PRボディを生成
 */
function generatePRBody(metadata, report) {
  const { area, fileStats, newFiles, linesAdded, linesDeleted, codeReduction, runNumber, runId, triggerEvent } = metadata;
  const repoSlug = process.env.GITHUB_REPOSITORY || "Unson-LLC/brainbase-unson";

  const newFilesSection = newFiles.length > 0
    ? newFiles.map(f => {
        const stat = fileStats.find(s => s.path === f);
        return `| \`${f}\` | +${stat?.added || 0} | 新規作成 |`;
      }).join("\n")
    : "";

  const modifiedFilesSection = fileStats
    .filter(f => !f.isNew)
    .map(f => {
      const change = f.deleted > f.added ? `-${f.deleted - f.added}` : `+${f.added - f.deleted}`;
      return `| \`${f.path}\` | -${f.deleted}, +${f.added} | リファクタ |`;
    })
    .join("\n");

  return `## 📝 変更サマリー

**リファクタリング領域**: ${area}

${report.split("## Changes Summary")[1]?.split("## Files Modified")[0]?.trim() || metadata.summary}

---

## 📊 影響範囲

### 変更ファイル (${fileStats.length}件)

| ファイル | 変更 | 種類 |
|---------|------|------|
${newFilesSection}
${modifiedFilesSection}

### コード削減効果
**合計: ${codeReduction > 0 ? `約${codeReduction}行削減` : `${Math.abs(codeReduction)}行増加`}** (-${linesDeleted}, +${linesAdded})

---

## 🔍 レビューポイント

### ✅ 確認してほしい点
1. 新規コンポーネントのAPI設計
   - 適切な責務分割ができているか？
   - 他の領域でも再利用可能か？

2. コンポーネントの配置場所
   - 現在の配置で適切か？
   - グローバル vs プライベートの判断は正しいか？

3. 命名・JSDocの品質
   - 分かりやすい命名になっているか？
   - JSDocは十分に具体的か？

### ⚠️ 注意事項
- **破壊的変更なし**: 既存の機能は全て保持
- **テスト**: 手動確認が必要（E2Eテスト未実装）

---

## 🤖 自動生成情報

<details>
<summary>自動リファクタリング詳細</summary>

- **ツール**: ops-department Auto Refactoring
- **Run Number**: ${runNumber}
- **Run ID**: ${runId}
- **実行日時**: ${new Date().toISOString()}
- **トリガー**: ${triggerEvent}
- **ワークフロー**: [weekly-refactoring.yml](https://github.com/${repoSlug}/actions/workflows/weekly-refactoring.yml)

詳細レポート: \`ops-department-refactoring.md\`

</details>`;
}

/**
 * メイン処理
 */
async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const scanOnly = args.includes("--scan-only");

  if (scanOnly) {
    const allAreas = scanCodebase();
    console.log(`✅ Found ${allAreas.length} areas`);
    console.log(allAreas.slice(0, 50).map((a) => `- ${a}`).join("\n"));
    if (allAreas.length > 50) {
      console.log(`... (${allAreas.length - 50} more)`);
    }
    return;
  }

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

  // 5. 履歴更新はPRとは分離する（baseブランチへ直接コミットするステップで反映する）
  // PRに refactoring-history.json を含めると add/add 競合しやすく、マージ時に壊れやすい。
  const refactoringEntry = {
    area: refactoringResult.area,
    refactored_at: new Date().toISOString(),
    files_modified: refactoringResult.files_modified,
    changes_summary: refactoringResult.changes_summary,
    run_number: process.env.GITHUB_RUN_NUMBER || null,
    run_id: process.env.GITHUB_RUN_ID || null,
    trigger_event: process.env.GITHUB_EVENT_NAME || null,
  };
  fs.writeFileSync(
    "refactoring-result.json",
    JSON.stringify(refactoringEntry, null, 2),
  );
  console.log("✅ Refactoring result saved to refactoring-result.json");

  // 6. レポート生成
  console.log("\n📄 Generating refactoring report...");
  const projectedRefactoredCount = history.areas.length + 1;
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
- Already refactored: ${projectedRefactoredCount}
- Remaining: ${unrefactoredAreas.length - 1}

---

This refactoring was automatically performed by the ops-department refactoring-specialist.
`;

  const reportPath = "ops-department-refactoring.md";
  fs.writeFileSync(reportPath, report);
  console.log(`✅ Report saved to ${reportPath}`);

  // 7. PRメッセージ生成
  console.log("\n📝 Generating PR message...");

  // git diff統計を取得
  const fileStats = getFileStats(refactoringResult.files_modified);
  const newFiles = getNewFiles(fileStats);
  const totalLines = getTotalLines(fileStats);
  const codeReduction = totalLines.deleted - totalLines.added;

  // メタデータ準備
  const prMetadata = {
    area: refactoringResult.area,
    summary: refactoringResult.changes_summary,
    summaryShort: refactoringResult.changes_summary.split(/[。\n]/)[0].substring(0, 60),
    fileStats,
    newFiles,
    linesAdded: totalLines.added,
    linesDeleted: totalLines.deleted,
    codeReduction,
    runNumber: process.env.GITHUB_RUN_NUMBER || "local",
    runId: process.env.GITHUB_RUN_ID || "unknown",
    triggerEvent: process.env.GITHUB_EVENT_NAME || "manual"
  };

  // PRタイトル・ボディ生成
  const prTitle = generatePRTitle(prMetadata);
  const prBody = generatePRBody(prMetadata, report);

  // PRメッセージをファイルに出力（GitHub Actionsで使用）
  fs.writeFileSync("pr-title.txt", prTitle);
  fs.writeFileSync("pr-body.txt", prBody);

  console.log(`✅ PR Title: ${prTitle}`);
  console.log(`✅ PR message saved to pr-title.txt, pr-body.txt`);

  console.log("\n" + "=".repeat(60));
  console.log("🎉 ops-department Auto Refactoring Complete!");
}

main().catch((error) => {
  console.error("❌ Fatal error:", error);
  process.exit(1);
});
