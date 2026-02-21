#!/usr/bin/env node
/**
 * ops-department Auto Refactoring Script
 *
 * Self-hosted GitHub ActionsランナーでAI CLI（Codex/Claude）を使用して
 * refactoring-specialist が未リファクタリング領域を特定し、
 * 実際にコードを修正してPR作成する。
 *
 * 実行タイミング: 3時間ごと (0:00, 3:00, 6:00, 9:00, 12:00, 15:00, 18:00, 21:00 UTC)
 * 実行環境: GitHub Actions (self-hosted runner)
 *
 * 戦略:
 * 1. リファクタリング履歴を読み込み（refactoring-history.json）
 * 2. コードベースをスキャンして未リファクタリング領域を特定
 * 3. refactoring-specialist が実際にコードを修正
 * 4. 結果を refactoring-result.json として出力（履歴更新は別スクリプトでbaseへ直接反映）
 *
 * Usage:
 *   node scripts/ops-team-review.cjs [--dry-run] [--scan-only]
 */

const { spawn, execSync } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

// リファクタリング履歴ファイル
const HISTORY_FILE = "refactoring-history.json";
const RESULT_FILE = "refactoring-result.json";
const RUN_STATUS_FILE = "ops-team-review-run-status.json";

const WORKFLOW_FILE =
  process.env.OPS_REFACTOR_WORKFLOW_FILE ||
  "ops-department-auto-refactoring.yml";

const JUDGE_THRESHOLD = Number.parseInt(
  process.env.OPS_REFACTOR_JUDGE_THRESHOLD || "80",
  10,
);
const JUDGE_MAX_ATTEMPTS = Number.parseInt(
  process.env.OPS_REFACTOR_MAX_ATTEMPTS || "3",
  10,
);
const JUDGE_MAX_DIFF_CHARS = Number.parseInt(
  process.env.OPS_REFACTOR_JUDGE_MAX_DIFF_CHARS || "12000",
  10,
);

const REFACTOR_TIMEOUT_MS = Number.parseInt(
  process.env.OPS_REFACTOR_TIMEOUT_MS || "600000",
  10,
);

const HOTSPOT_SINCE_DAYS = Number.parseInt(
  process.env.OPS_REFACTOR_HOTSPOT_SINCE_DAYS || "30",
  10,
);

const COOLDOWN_DAYS = Number.parseInt(
  process.env.OPS_REFACTOR_COOLDOWN_DAYS || "30",
  10,
);

const TARGET_TOP_N = Number.parseInt(
  process.env.OPS_REFACTOR_TARGET_TOP_N || "20",
  10,
);

const REFACTOR_TIER = (process.env.OPS_REFACTOR_TIER || "small").toLowerCase();

const DETECTION_MODE = (
  process.env.OPS_REFACTOR_DETECTION_MODE || "hybrid"
).toLowerCase();

const REFACTOR_SOURCE_DIRS = ["public/modules", "server", "lib"];

const MAX_CHANGED_FILES = Number.parseInt(
  process.env.OPS_REFACTOR_MAX_FILES || "10",
  10,
);
const MAX_CHANGED_LINES = Number.parseInt(
  process.env.OPS_REFACTOR_MAX_LINES || "400",
  10,
);

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

Refactor constraints:
- Tier: ${REFACTOR_TIER}
- Keep changes incremental and backward compatible.
- Do NOT modify workflow files under .github/workflows/ or package-lock.json.
- Keep PR size small:
  - Max changed files (guard): ${MAX_CHANGED_FILES}
  - Max changed lines (guard): ${MAX_CHANGED_LINES}
- If you must change runtime behavior, clearly explain why and add/update tests.

Tier guidelines:
- small: touch 1-3 files, prefer local refactors (extract helpers/components, naming, reduce duplication).
- medium: up to ~10 files within the same area, allowed to extract shared helpers/components inside that area.

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

let lastRefactorAttempt = {
  reason: null,
  details: {},
};

function clearRefactorAttemptFailure() {
  lastRefactorAttempt = { reason: null, details: {} };
}

function setRefactorAttemptFailure(reason, details = {}) {
  lastRefactorAttempt = {
    reason,
    details,
  };
}

function toFailureSummary() {
  return {
    ...lastRefactorAttempt,
  };
}

function writeRunStatus(status, reason, details = {}) {
  const payload = {
    status,
    reason,
    details,
    timestamp: new Date().toISOString(),
    workflow: WORKFLOW_FILE,
    runId: process.env.GITHUB_RUN_ID || null,
    runNumber: process.env.GITHUB_RUN_NUMBER || null,
    eventName: process.env.GITHUB_EVENT_NAME || null,
  };

  try {
    fs.writeFileSync(RUN_STATUS_FILE, JSON.stringify(payload, null, 2));
  } catch (error) {
    console.warn("⚠️  Failed to write run status file:", error.message);
  }

  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) return;

  const sanitize = (value) => `${value}`.replace(/\r?\n/g, " ").trim();
  try {
    fs.appendFileSync(outputPath, `status=${sanitize(status)}\n`);
    fs.appendFileSync(outputPath, `reason=${sanitize(reason)}\n`);
    fs.appendFileSync(outputPath, `ops_review_status=${sanitize(status)}\n`);
    fs.appendFileSync(outputPath, `ops_review_reason=${sanitize(reason)}\n`);
  } catch (error) {
    console.warn("⚠️  Failed to write GitHub step output:", error.message);
  }
}

/**
 * Codex CLIを使用してテキスト生成
 */
async function generateWithCodex(systemPrompt, userPrompt, options = {}) {
  const { timeout = 300000 } = options;
  const codexPath = process.env.CODEX_CLI_PATH || "codex";
  const reasoningEffort = process.env.CODEX_REASONING_EFFORT || "high";
  const homeDir =
    process.env.REAL_HOME ||
    process.env.HOME ||
    process.env.USERPROFILE ||
    "/tmp";
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

function isTimeoutError(message = "") {
  const normalized = `${message}`.toLowerCase();
  return normalized.includes("timed out") || normalized.includes("timeout");
}

/**
 * Claude CLIを使用してテキスト生成（フォールバック用）
 */
async function generateWithClaude(systemPrompt, userPrompt, options = {}) {
  const { timeout = 300000 } = options;
  const homeDir =
    process.env.REAL_HOME ||
    process.env.HOME ||
    process.env.USERPROFILE ||
    "/tmp";
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

function sha256(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function getRepoStateFingerprint() {
  const status = execSync("git status --porcelain || true", {
    encoding: "utf-8",
    maxBuffer: 10 * 1024 * 1024,
  });
  const diff = execSync("git diff || true", {
    encoding: "utf-8",
    maxBuffer: 50 * 1024 * 1024,
  });
  return sha256(`${status}\n---\n${diff}`);
}

function getActionableChangedFiles() {
  let tracked = "";
  let untracked = "";
  try {
    tracked = execSync("git diff --name-only || true", {
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch (_error) {
    tracked = "";
  }

  try {
    untracked = execSync("git ls-files --others --exclude-standard || true", {
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch (_error) {
    untracked = "";
  }

  const all = new Set(
    `${tracked}\n${untracked}`
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean),
  );

  return Array.from(all)
    .filter((f) => f !== "ops-department-refactoring.md")
    .sort();
}

function discardWorkingTreeChanges() {
  try {
    execSync("git restore --staged --worktree .", { stdio: "inherit" });
  } catch (error) {
    console.warn("⚠️  git restore failed:", error.message);
  }

  let untracked = [];
  try {
    const out = execSync("git ls-files --others --exclude-standard || true", {
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024,
    }).trim();
    if (out) untracked = out.split("\n").filter(Boolean);
  } catch (_error) {
    untracked = [];
  }

  for (const p of untracked) {
    try {
      fs.rmSync(p, { recursive: true, force: true });
    } catch (_error) {
      // ignore
    }
  }
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
 * コードベースをスキャンして領域リストを作成
 */
function scanCodebase() {
  const areas = new Set();

  REFACTOR_SOURCE_DIRS.forEach((dir) => {
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
        const rawArea = path.dirname(file);
        if (!rawArea || rawArea === ".") return;

        if (rawArea) areas.add(rawArea);
      });
  });

  return Array.from(areas).sort();
}

/**
 * 静的分析: ファイルサイズベースのスコア計算
 * 大きなファイル（1000行以上）ほど高スコア
 */
function computeLargeFileScores() {
  const scores = new Map();
  const srcDirs = REFACTOR_SOURCE_DIRS; // ["public/modules", "server", "lib"]

  srcDirs.forEach((dir) => {
    if (!fs.existsSync(dir)) return;

    try {
      const files = execSync(
        `find "${dir}" -type f \\( -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.jsx" -o -name "*.cjs" -o -name "*.mjs" \\)`,
        { encoding: "utf-8", maxBuffer: 10 * 1024 * 1024 }
      )
        .trim()
        .split("\n")
        .filter(Boolean);

      files.forEach((file) => {
        if (!fs.existsSync(file)) return;

        const content = fs.readFileSync(file, "utf-8");
        const lines = content.split(/\r\n|\r|\n/).length;

        // 1000行以上のファイルにスコア付与（行数に応じて増加）
        if (lines >= 1000) {
          const area = normalizeAreaFromFilePath(file);
          if (!area) return;

          // スコア = 行数 / 100（例: 2470行 → 24.7点）
          const score = Math.floor(lines / 100);
          scores.set(area, (scores.get(area) || 0) + score);
        }
      });
    } catch (error) {
      console.warn(`Large file scan failed for ${dir}:`, error.message);
    }
  });

  return scores;
}

/**
 * 静的分析: 関数・メソッド数ベースの複雑度スコア
 * 多くの関数を持つファイルほど高スコア
 */
function computeComplexityScores() {
  const scores = new Map();
  const srcDirs = REFACTOR_SOURCE_DIRS;

  srcDirs.forEach((dir) => {
    if (!fs.existsSync(dir)) return;

    try {
      const files = execSync(
        `find "${dir}" -type f \\( -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.jsx" -o -name "*.cjs" -o -name "*.mjs" \\)`,
        { encoding: "utf-8", maxBuffer: 10 * 1024 * 1024 }
      )
        .trim()
        .split("\n")
        .filter(Boolean);

      files.forEach((file) => {
        if (!fs.existsSync(file)) return;

        const content = fs.readFileSync(file, "utf-8");

        // 関数・メソッド定義をカウント（簡易的な正規表現）
        const functionPatterns = [
          /\bfunction\s+\w+/g,           // function foo()
          /\b\w+\s*\([^)]*\)\s*\{/g,     // foo() {
          /\b\w+\s*=\s*\([^)]*\)\s*=>/g, // foo = () =>
          /\basync\s+\w+/g,              // async foo()
        ];

        let functionCount = 0;
        functionPatterns.forEach((pattern) => {
          const matches = content.match(pattern);
          if (matches) functionCount += matches.length;
        });

        // 50個以上の関数を持つファイルにスコア付与
        if (functionCount >= 50) {
          const area = normalizeAreaFromFilePath(file);
          if (!area) return;

          // スコア = 関数数 / 10（例: 121関数 → 12.1点）
          const score = Math.floor(functionCount / 10);
          scores.set(area, (scores.get(area) || 0) + score);
        }
      });
    } catch (error) {
      console.warn(`Complexity scan failed for ${dir}:`, error.message);
    }
  });

  return scores;
}

/**
 * 静的分析: コード重複ベースのスコア
 * 同じパターンが繰り返される領域ほど高スコア
 */
function computeDuplicationScores() {
  const scores = new Map();
  const srcDirs = REFACTOR_SOURCE_DIRS;

  // よくある重複パターン（brainbase-unson向けに調整）
  const duplicationPatterns = [
    /if\s*\(\s*!apiKey\s*\)/g,                                    // API key check
    /const\s+session\s*=\s*await\s+auth\.api\.getSession/g,       // Session fetch (Next.js用、brainbaseでは不要かも)
    /if\s*\(\s*!session\?\.user\?\.id\s*\)/g,                     // Session validation
    /:\s*any\b/g,                                                  // any type usage
    /require\s*\(\s*['"][^'"]+['"]\s*\)/g,                        // require() calls (Node.js)
  ];

  srcDirs.forEach((dir) => {
    if (!fs.existsSync(dir)) return;

    try {
      const files = execSync(
        `find "${dir}" -type f \\( -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.jsx" -o -name "*.cjs" -o -name "*.mjs" \\)`,
        { encoding: "utf-8", maxBuffer: 10 * 1024 * 1024 }
      )
        .trim()
        .split("\n")
        .filter(Boolean);

      files.forEach((file) => {
        if (!fs.existsSync(file)) return;

        const content = fs.readFileSync(file, "utf-8");

        let totalDuplication = 0;
        duplicationPatterns.forEach((pattern) => {
          const matches = content.match(pattern);
          if (matches && matches.length >= 3) {
            totalDuplication += matches.length;
          }
        });

        // 重複が3箇所以上あるファイルにスコア付与
        if (totalDuplication >= 3) {
          const area = normalizeAreaFromFilePath(file);
          if (!area) return;

          scores.set(area, (scores.get(area) || 0) + totalDuplication);
        }
      });
    } catch (error) {
      console.warn(`Duplication scan failed for ${dir}:`, error.message);
    }
  });

  return scores;
}

/**
 * スコア統合（複数のスコアMapをマージ）
 */
function mergeScores(...scoreMaps) {
  const merged = new Map();
  scoreMaps.forEach((scoreMap) => {
    for (const [area, score] of scoreMap.entries()) {
      merged.set(area, (merged.get(area) || 0) + score);
    }
  });
  return merged;
}

/**
 * ファイルパスから "area"（そのままディレクトリ）を正規化
 */
function normalizeAreaFromFilePath(filePath) {
  const rawArea = path.dirname(filePath);
  if (!rawArea || rawArea === ".") return "";
  return rawArea;
}

/**
 * ホットスポットスコア（最近変更が多い領域）を計算
 */
function computeHotspotScores(params = {}) {
  const sinceDaysRaw = params.sinceDays ?? HOTSPOT_SINCE_DAYS;
  const sinceDays = Number.isFinite(sinceDaysRaw) ? sinceDaysRaw : 0;
  const scores = new Map();

  if (sinceDays <= 0) return scores;

  let logOutput = "";
  try {
    logOutput = execSync(
      `git log --since="${sinceDays} days ago" --name-only --pretty=format: --no-merges`,
      {
        encoding: "utf-8",
        maxBuffer: 50 * 1024 * 1024,
      },
    );
  } catch (_error) {
    return scores;
  }

  logOutput
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((file) => {
      if (!REFACTOR_SOURCE_DIRS.some((dir) => file.startsWith(`${dir}/`))) {
        return;
      }
      if (!/\.(cjs|mjs|js|tsx?|jsx?)$/.test(file)) return;

      const area = normalizeAreaFromFilePath(file);
      if (!area) return;

      scores.set(area, (scores.get(area) || 0) + 1);
    });

  return scores;
}

function getLatestHistoryEntryByArea(history) {
  const latestByArea = new Map();
  for (const entry of history?.areas || []) {
    if (!entry?.area) continue;
    const existing = latestByArea.get(entry.area);
    if (!existing) {
      latestByArea.set(entry.area, entry);
      continue;
    }

    const existingTs = Date.parse(existing.refactored_at || "") || 0;
    const nextTs = Date.parse(entry.refactored_at || "") || 0;
    if (nextTs >= existingTs) {
      latestByArea.set(entry.area, entry);
    }
  }
  return latestByArea;
}

function isAreaEligible(params) {
  const { entry, cooldownDays } = params;

  if (!entry) return true;

  // Don't create parallel PRs for the same area.
  if (entry.pr_status === "open") return false;

  // If it was closed (not merged), retry.
  if (entry.pr_status === "closed") return true;

  const refactoredAt = Date.parse(entry.refactored_at || "");
  if (!Number.isFinite(refactoredAt)) return true;

  const cooldownMs = Math.max(0, cooldownDays) * 24 * 60 * 60 * 1000;
  return Date.now() - refactoredAt >= cooldownMs;
}

/**
 * 次に対象とする領域を選ぶ（ホットスポット優先 + クールダウン）
 */
function findEligibleAreas(allAreas, history, params = {}) {
  const cooldownDaysRaw = params.cooldownDays ?? COOLDOWN_DAYS;
  const cooldownDays = Number.isFinite(cooldownDaysRaw) ? cooldownDaysRaw : 0;
  const latestByArea = getLatestHistoryEntryByArea(history);

  return allAreas.filter((area) =>
    isAreaEligible({ entry: latestByArea.get(area), cooldownDays }),
  );
}

function selectTargetArea(eligibleAreas, hotspotScores, params = {}) {
  const topNRaw = params.topN ?? TARGET_TOP_N;
  const topN = Number.isFinite(topNRaw) ? Math.max(1, topNRaw) : 20;
  const staticScores = params.staticScores || new Map();
  const mode = params.mode || DETECTION_MODE;

  // モードに応じてスコアを選択
  let finalScores = new Map();
  if (mode === "hotspot") {
    finalScores = hotspotScores;
  } else if (mode === "static") {
    finalScores = staticScores;
  } else {
    // hybridモード（デフォルト）: 両方を統合
    finalScores = mergeScores(hotspotScores, staticScores);
  }

  const scored = eligibleAreas.map((area) => ({
    area,
    score: finalScores.get(area) || 0,
    hotspot: hotspotScores.get(area) || 0,
    static: staticScores.get(area) || 0,
  }));

  scored.sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    return null;
  }

  const selected = scored[0];
  console.log(
    `  🎯 Selected: ${selected.area} (total: ${selected.score}, hotspot: ${selected.hotspot}, static: ${selected.static}, mode: ${mode})`
  );

  return selected.area;
}

/**
 * 領域のファイル一覧を取得
 */
function getFilesInArea(area) {
  try {
    const baseDir = area;
    const files = execSync(`git ls-files "${baseDir}"`, {
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024,
    })
      .trim()
      .split("\n")
      .filter(Boolean)
      .filter((file) => path.dirname(file) === baseDir)
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

  clearRefactorAttemptFailure();

  if (files.length === 0) {
    setRefactorAttemptFailure("empty_area", { area, fileCount: 0 });
    return null;
  }

  // Keep scope disciplined by limiting context size based on tier.
  const tierPromptMaxFiles = REFACTOR_TIER === "medium" ? 10 : 3;
  const promptMaxFiles = Math.min(
    Math.max(1, tierPromptMaxFiles),
    Number.isFinite(MAX_CHANGED_FILES) && MAX_CHANGED_FILES > 0
      ? MAX_CHANGED_FILES
      : tierPromptMaxFiles,
  );
  const contentCharLimit = REFACTOR_TIER === "medium" ? 12000 : 8000;

  const ranked = files
    .map((file) => {
      const content = getFileContent(file);
      const lines = content ? content.split(/\r\n|\r|\n/).length : 0;
      return { file, lines, content };
    })
    .sort((a, b) => b.lines - a.lines || a.file.localeCompare(b.file, "en"));

  const fileContents = ranked.slice(0, promptMaxFiles).map((f) => ({
    path: f.file,
    lines: f.lines,
    content: f.content.slice(0, contentCharLimit),
  }));

  const userPrompt = `以下の領域のコードをリファクタリングしてください:

領域: ${area}

制約:
- Tier: ${REFACTOR_TIER}
- PRサイズガード: 変更ファイル数 <= ${MAX_CHANGED_FILES}, 差分行数 <= ${MAX_CHANGED_LINES}
- package-lock.json と .github/workflows/ 配下は変更しない
- 既存挙動を壊さない（挙動変更が必要なら理由を明記し、テストを追加/更新する）
- scopeを広げすぎない（smallは特に1-3ファイル中心）

ファイル:
${fileContents
  .map(
    (f) => `
--- ${f.path} (approx ${f.lines} lines) ---
${f.content}
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
      { timeout: REFACTOR_TIMEOUT_MS },
    );

    // JSON抽出
    let jsonStr = result;
    const jsonMatch = result.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1];
    }

    const refactoringResult = JSON.parse(jsonStr.trim());
    // Force consistency with the selected area (avoid model drift).
    refactoringResult.area = area;
    console.log("  ✅ Refactoring completed");
    console.log(`  📝 ${refactoringResult.changes_summary}`);

    return refactoringResult;
  } catch (error) {
    const message = error?.message || "unknown";
    if (isTimeoutError(message)) {
      console.error("  ❌ Refactoring failed (timeout):", message);
      setRefactorAttemptFailure("codex_timeout", {
        area,
        message,
        timeoutMs: REFACTOR_TIMEOUT_MS,
      });
    } else {
      console.error("  ❌ Refactoring failed:", message);
      setRefactorAttemptFailure("refactor_area_error", {
        area,
        message,
      });
    }
    return null;
  }
}

function extractJsonFromOutput(text) {
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  return (jsonMatch ? jsonMatch[1] : text).trim();
}

async function judgeRefactorQuality(params) {
  const { area, attempt, threshold } = params;
  const changedFiles = getActionableChangedFiles();
  const fileStats = getFileStats(changedFiles);
  const newFiles = getNewFiles(fileStats);

  let diffStat = "";
  let diffPatch = "";
  try {
    diffStat = execSync("git diff --stat || true", {
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024,
    }).trim();
  } catch (_error) {
    diffStat = "";
  }

  try {
    diffPatch = execSync("git diff --unified=3 || true", {
      encoding: "utf-8",
      maxBuffer: 50 * 1024 * 1024,
    });
  } catch (_error) {
    diffPatch = "";
  }

  if (diffPatch.length > JUDGE_MAX_DIFF_CHARS) {
    diffPatch = `${diffPatch.slice(0, JUDGE_MAX_DIFF_CHARS)}\n\n[TRUNCATED]`;
  }

  const newFilesBlobs =
    newFiles.length > 0
      ? newFiles
          .map((f) => {
            const content = getFileContent(f).substring(0, 8000);
            return `--- ${f} ---\n${content}`;
          })
          .join("\n\n")
      : "(none)";

  const systemPrompt = `You are an LLM-as-a-Judge for automated refactoring PRs.

You must NOT modify files, run commands, or use any tools. You only evaluate the provided diff/context.
Be strict and prioritize safety (no behavior changes), scope discipline, and code clarity.

Return JSON only in this format:
{
  "score": 0-100,
  "summary": "one-paragraph summary",
  "must_fix": ["..."],
  "suggestions": ["..."]
}`;

  const userPrompt = `Judge the following refactor attempt.

Repo context: Express.js/Node.js codebase (ESM modules).
Area: ${area}
Attempt: ${attempt}
Passing threshold: ${threshold}

Changed files (${changedFiles.length}):
${changedFiles.map((f) => `- ${f}`).join("\n") || "(none)"}

Diff stat:
${diffStat || "(empty)"}

Diff patch (may be truncated):
${diffPatch || "(empty)"}

New files content (truncated):
${newFilesBlobs}

Scoring rubric (0-100):
- Safety & correctness (0-40): behavior preserved, types ok, no risky changes
- Clarity & maintainability (0-30): naming/structure/DRY improvements
- Scope discipline (0-20): cohesive changes, no drive-by edits
- Testing & confidence (0-10): tests updated if needed, or rationale if not

Return JSON only.`;

  const before = getRepoStateFingerprint();
  const raw = await generateWithAI(systemPrompt, userPrompt, {
    timeout: 600000,
  });
  const after = getRepoStateFingerprint();
  if (before !== after) {
    throw new Error("Judge must be read-only (working tree changed).");
  }

  let parsed = null;
  try {
    parsed = JSON.parse(extractJsonFromOutput(raw));
  } catch (error) {
    return {
      score: 0,
      pass: false,
      threshold,
      summary: `Judge output was not valid JSON: ${error.message}`,
      must_fix: ["Judge output parse failed"],
      suggestions: [],
    };
  }

  const score = Number(parsed?.score);
  const normalizedScore = Number.isFinite(score)
    ? Math.max(0, Math.min(100, score))
    : 0;

  const mustFix = Array.isArray(parsed?.must_fix)
    ? parsed.must_fix
        .map((v) => `${v}`)
        .filter(Boolean)
        .slice(0, 20)
    : [];

  const suggestions = Array.isArray(parsed?.suggestions)
    ? parsed.suggestions
        .map((v) => `${v}`)
        .filter(Boolean)
        .slice(0, 20)
    : [];

  const summary = typeof parsed?.summary === "string" ? parsed.summary : "";

  return {
    score: Math.round(normalizedScore),
    pass: Math.round(normalizedScore) >= threshold,
    threshold,
    summary,
    must_fix: mustFix,
    suggestions,
  };
}

async function reviseRefactorAttempt(params) {
  const { area, attempt, threshold, judge, changedFiles } = params;
  const filesToShow = (changedFiles || []).slice(0, 5);
  const fileContents = filesToShow.map((file) => ({
    path: file,
    content: getFileContent(file),
  }));

  let diffPatch = "";
  try {
    diffPatch = execSync("git diff --unified=3 || true", {
      encoding: "utf-8",
      maxBuffer: 50 * 1024 * 1024,
    });
  } catch (_error) {
    diffPatch = "";
  }
  if (diffPatch.length > JUDGE_MAX_DIFF_CHARS) {
    diffPatch = `${diffPatch.slice(0, JUDGE_MAX_DIFF_CHARS)}\n\n[TRUNCATED]`;
  }

  const userPrompt = `前回のリファクタ結果がJudgeで不合格でした。スコアを ${threshold} 以上に引き上げるように修正してください。

領域: ${area}
Attempt: ${attempt}
Judge score: ${judge?.score ?? "unknown"}/${threshold}
Judge summary: ${judge?.summary ?? ""}

Must-fix:
${(judge?.must_fix || []).map((t) => `- ${t}`).join("\n") || "- (none)"}

Suggestions:
${(judge?.suggestions || []).map((t) => `- ${t}`).join("\n") || "- (none)"}

現在のdiff (truncated):
${diffPatch || "(empty)"}

制約:
- 既存挙動を絶対に壊さない
- スコープを広げない（無関係ファイルに触らない）
- 依存追加や lockfile 変更はしない
- 必要なら変更を戻して良い（安全/可読性優先）

対象ファイル（必要に応じて編集してください。最大5件だけ添付）:
${fileContents
  .map(
    (f) => `
--- ${f.path} ---
${f.content.substring(0, 10000)}
`,
  )
  .join("\n")}

IMPORTANT: Editツールを使って実際にファイルを修正してください！

出力形式(JSONのみ):
{
  "refactored": true/false,
  "files_modified": ["path/to/file"],
  "changes_summary": "変更内容の説明",
  "area": "${area}"
}`;

  try {
    const raw = await generateWithAI(
      REFACTORING_SPECIALIST.systemPrompt,
      userPrompt,
      {
        timeout: REFACTOR_TIMEOUT_MS,
      },
    );
    const refactoringResult = JSON.parse(extractJsonFromOutput(raw));
    refactoringResult.area = area;
    return refactoringResult;
  } catch (error) {
    const message = error?.message || "unknown";
    if (isTimeoutError(message)) {
      console.error("  ❌ Revision attempt failed (timeout):", message);
      setRefactorAttemptFailure("revision_timeout", {
        area,
        attempt,
        message,
        timeoutMs: REFACTOR_TIMEOUT_MS,
      });
    } else {
      console.error("  ❌ Revision attempt failed:", message);
      setRefactorAttemptFailure("revision_error", {
        area,
        attempt,
        message,
      });
    }
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
        ? `git diff --numstat HEAD -- "${file}" 2>/dev/null || echo "0\\t0\\t${file}"`
        : `git diff --numstat --no-index -- /dev/null "${file}" 2>/dev/null || echo "0\\t0\\t${file}"`;

      const diffStat = execSync(diffCmd, { encoding: "utf-8" }).trim();

      const [added, deleted, filePath] = diffStat.split("\t");
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
    return files.map((f) => ({ path: f, added: 0, deleted: 0, isNew: false }));
  }
}

/**
 * 新規ファイル一覧を取得
 */
function getNewFiles(fileStats) {
  return fileStats.filter((f) => f.isNew).map((f) => f.path);
}

/**
 * 合計追加・削除行数を取得
 */
function getTotalLines(fileStats) {
  return fileStats.reduce(
    (acc, f) => ({
      added: acc.added + f.added,
      deleted: acc.deleted + f.deleted,
    }),
    { added: 0, deleted: 0 },
  );
}

/**
 * PRタイトルを生成
 */
function generatePRTitle(metadata) {
  const { area, newFiles, codeReduction } = metadata;

  // 新規ファイルから主要なコンポーネント名を抽出
  const mainComponents = newFiles
    .map((f) => path.basename(f, path.extname(f)))
    .filter((name) => name.length > 0)
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
  const {
    area,
    fileStats,
    newFiles,
    linesAdded,
    linesDeleted,
    codeReduction,
    runNumber,
    runId,
    triggerEvent,
  } = metadata;
  const repoSlug = process.env.GITHUB_REPOSITORY || "Unson-LLC/brainbase";

  const newFilesSection =
    newFiles.length > 0
      ? newFiles
          .map((f) => {
            const stat = fileStats.find((s) => s.path === f);
            return `| \`${f}\` | +${stat?.added || 0} | 新規作成 |`;
          })
          .join("\n")
      : "";

  const modifiedFilesSection = fileStats
    .filter((f) => !f.isNew)
    .map((f) => {
      return `| \`${f.path}\` | -${f.deleted}, +${f.added} | リファクタ |`;
    })
    .join("\n");

  return `## 📝 変更サマリー

**リファクタリング領域**: ${area}
${metadata.judgeScore != null ? `\n**Judge Score**: ${metadata.judgeScore}/100 (threshold ${metadata.judgeThreshold})\n` : ""}

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
1. 変更内容の妥当性
   - 副作用や挙動変更が紛れていないか？

2. 例外系・境界条件
   - エラー処理やnull/undefinedの扱いが適切か？

3. 命名・責務の分割
   - 分かりやすい命名になっているか？
   - 責務が過剰に広がっていないか？

### ⚠️ 注意事項
- **破壊的変更なし**: 既存の機能は全て保持する前提
- **テスト**: 追加が必要な場合あり

---

## 🤖 自動生成情報

<details>
<summary>自動リファクタリング詳細</summary>

- **ツール**: ops-department Auto Refactoring
- **Run Number**: ${runNumber}
- **Run ID**: ${runId}
- **実行日時**: ${new Date().toISOString()}
- **トリガー**: ${triggerEvent}
- **ワークフロー**: [${WORKFLOW_FILE}](https://github.com/${repoSlug}/actions/workflows/${WORKFLOW_FILE})

詳細レポート: このPR本文の「変更サマリー」に含まれます。

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
    console.log(
      allAreas
        .slice(0, 50)
        .map((a) => `- ${a}`)
        .join("\n"),
    );
    if (allAreas.length > 50) {
      console.log(`... (${allAreas.length - 50} more)`);
    }
    writeRunStatus("success", "scan_only", {
      areaCount: allAreas.length,
    });
    return;
  }

  console.log("🤖 ops-department Auto Refactoring Starting...");
  console.log("=".repeat(60));
  console.log(`Mode: ${dryRun ? "DRY RUN" : "PRODUCTION"}`);
  console.log("=".repeat(60));

  // 1. 履歴読み込み
  console.log("\n📖 Loading refactoring history...");
  const history = loadRefactoringHistory();
  console.log(`  ✅ ${history.areas.length} history entries`);

  // 2. コードベーススキャン
  console.log("\n🔍 Scanning codebase...");
  const allAreas = scanCodebase();
  console.log(`  ✅ Found ${allAreas.length} total areas`);

  console.log("\n🔥 Computing hotspots...");
  const hotspotScores = computeHotspotScores({ sinceDays: HOTSPOT_SINCE_DAYS });
  console.log(
    `  ✅ Hotspot window: last ${HOTSPOT_SINCE_DAYS} days (tier=${REFACTOR_TIER})`,
  );

  // 静的分析の追加
  console.log("\n🔬 Computing static analysis scores...");
  console.log(`  Detection mode: ${DETECTION_MODE}`);

  let staticScores = new Map();
  if (DETECTION_MODE === "static" || DETECTION_MODE === "hybrid") {
    console.log("  🔍 Scanning large files...");
    const largeFileScores = computeLargeFileScores();
    console.log(`    ✅ Found ${largeFileScores.size} areas with large files`);

    console.log("  🔍 Scanning complexity...");
    const complexityScores = computeComplexityScores();
    console.log(`    ✅ Found ${complexityScores.size} areas with high complexity`);

    console.log("  🔍 Scanning code duplication...");
    const duplicationScores = computeDuplicationScores();
    console.log(`    ✅ Found ${duplicationScores.size} areas with duplication`);

    staticScores = mergeScores(largeFileScores, complexityScores, duplicationScores);
    console.log(`  ✅ Total static analysis areas: ${staticScores.size}`);
  }

  // 3. 対象領域（ホットスポット優先 + クールダウン）を選択
  const eligibleAreas = findEligibleAreas(allAreas, history, {
    cooldownDays: COOLDOWN_DAYS,
  });
  console.log(
    `  ✅ ${eligibleAreas.length} eligible areas (cooldown ${COOLDOWN_DAYS} days)`,
  );

  if (eligibleAreas.length === 0) {
    console.log(
      "\n🎉 No eligible areas found (all areas are within cooldown or have open PRs).",
    );
    writeRunStatus("skipped", "no_eligible_areas");
    return;
  }

  const targetArea = selectTargetArea(eligibleAreas, hotspotScores, {
    topN: TARGET_TOP_N,
    staticScores,
    mode: DETECTION_MODE,
  });
  if (!targetArea) {
    console.log("\n⚠️  Failed to select a target area.");
    writeRunStatus("skipped", "no_target_area");
    return;
  }
  const files = getFilesInArea(targetArea);
  const hotspotScore = hotspotScores.get(targetArea) || 0;

  console.log(
    `\n🎯 Target area: ${targetArea} (hotspot score: ${hotspotScore}, cooldown: ${COOLDOWN_DAYS}d)`,
  );

  const threshold = Math.max(0, Math.min(100, JUDGE_THRESHOLD));
  const maxAttempts = Math.max(1, JUDGE_MAX_ATTEMPTS);

  let refactoringResult = null;
  let judge = null;
  let changedFiles = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (attempt === 1) {
      refactoringResult = await refactorArea(targetArea, files);
    } else {
      refactoringResult = await reviseRefactorAttempt({
        area: targetArea,
        attempt,
        threshold,
        judge,
        changedFiles,
      });
    }

    if (!refactoringResult || !refactoringResult.refactored) {
      console.log("\n❌ No refactoring was performed");
      discardWorkingTreeChanges();
      writeRunStatus("skipped", "refactor_not_performed", {
        attempt,
        area: targetArea,
        failure: toFailureSummary(),
      });
      return;
    }

    changedFiles = getActionableChangedFiles();
    if (changedFiles.length === 0) {
      console.log(
        "\nℹ️  No actionable code changes detected. Skipping PR creation.",
      );
      discardWorkingTreeChanges();
      writeRunStatus("skipped", "no_actionable_changes", {
        attempt,
        area: targetArea,
        failure: toFailureSummary(),
      });
      return;
    }

    // Use git as source of truth (model output may drift).
    refactoringResult.files_modified = changedFiles;

    try {
      judge = await judgeRefactorQuality({
        area: targetArea,
        attempt,
        threshold,
      });
    } catch (error) {
      console.error("  ❌ Judge failed:", error.message);
      judge = {
        score: 0,
        pass: false,
        threshold,
        summary: `Judge failed: ${error.message}`,
        must_fix: [error.message],
        suggestions: [],
      };
    }

    console.log(
      `  🧪 Judge score: ${judge.score}/100 (threshold ${threshold})`,
    );

    if (judge.pass) {
      break;
    }

    if (attempt < maxAttempts) {
      console.log(
        `\n🔁 Retrying to improve judge score... (${attempt + 1}/${maxAttempts})`,
      );
    }
  }

  if (!judge || !judge.pass) {
    console.log(
      `\n❌ Judge threshold not met after ${maxAttempts} attempt(s). Discarding changes.`,
    );
    discardWorkingTreeChanges();
    writeRunStatus("skipped", "judge_threshold_not_met", {
      area: targetArea,
      attemptCount: maxAttempts,
    });
    return;
  }

  // 5. 履歴更新はPRとは分離する（baseブランチへ直接コミットするステップで反映する）
  const refactoringEntry = {
    area: refactoringResult.area,
    refactored_at: new Date().toISOString(),
    files_modified: refactoringResult.files_modified,
    changes_summary: refactoringResult.changes_summary,
    tier: REFACTOR_TIER,
    hotspot_since_days: HOTSPOT_SINCE_DAYS,
    hotspot_score: hotspotScore,
    cooldown_days: COOLDOWN_DAYS,
    refactor_timeout_ms: REFACTOR_TIMEOUT_MS,
    judge_score: judge.score,
    judge_threshold: judge.threshold,
    judge_summary: judge.summary,
    judge_must_fix: judge.must_fix,
    judge_suggestions: judge.suggestions,
    run_number: process.env.GITHUB_RUN_NUMBER || null,
    run_id: process.env.GITHUB_RUN_ID || null,
    trigger_event: process.env.GITHUB_EVENT_NAME || null,
  };
  fs.writeFileSync(RESULT_FILE, JSON.stringify(refactoringEntry, null, 2));
  console.log(`✅ Refactoring result saved to ${RESULT_FILE}`);

  // 6. レポート生成
  console.log("\n📄 Generating refactoring report...");
  const coveredAreas = new Set(
    (history.areas || [])
      .filter((entry) => entry && entry.area && entry.pr_status !== "closed")
      .map((entry) => entry.area),
  );
  coveredAreas.add(refactoringResult.area);

  const projectedCoveredCount = coveredAreas.size;
  const projectedHistoryEntries = (history.areas || []).length + 1;
  const remainingAreas = Math.max(0, allAreas.length - projectedCoveredCount);
  const report = `# ops-department Auto Refactoring Report

Generated: ${new Date().toISOString()}

## Refactored Area

**${refactoringResult.area}**

## Changes Summary

${refactoringResult.changes_summary}

## Judge

- Score: ${judge.score}/100 (threshold ${judge.threshold})
- Summary: ${judge.summary || "(none)"}
- Must-fix:
${judge.must_fix.length > 0 ? judge.must_fix.map((t) => `  - ${t}`).join("\n") : "  - (none)"}

## Files Modified

${refactoringResult.files_modified.map((f) => `- ${f}`).join("\n")}

## Progress

- Total areas: ${allAreas.length}
- Covered (unique): ${projectedCoveredCount}
- Remaining (unique): ${remainingAreas}
- Total runs (history entries): ${projectedHistoryEntries}
- Tier: ${REFACTOR_TIER}
- Hotspot score (last ${HOTSPOT_SINCE_DAYS}d): ${hotspotScore}

---

This refactoring was automatically performed by the ops-department refactoring-specialist.
`;

  const reportFileName = `ops-department-refactoring-${process.env.GITHUB_RUN_ID || Date.now()}.md`;
  const reportPath = process.env.GITHUB_ACTIONS
    ? path.join(process.env.RUNNER_TEMP || "/tmp", reportFileName)
    : "ops-department-refactoring.md";
  fs.writeFileSync(reportPath, report);
  console.log(`✅ Report saved to ${reportPath} (not committed to git)`);

  // 7. PRメッセージ生成
  console.log("\n📝 Generating PR message...");

  const fileStats = getFileStats(refactoringResult.files_modified);
  const newFiles = getNewFiles(fileStats);
  const totalLines = getTotalLines(fileStats);
  const codeReduction = totalLines.deleted - totalLines.added;

  const prMetadata = {
    area: refactoringResult.area,
    summary: refactoringResult.changes_summary,
    summaryShort: refactoringResult.changes_summary
      .split(/[。\n]/)[0]
      .substring(0, 60),
    fileStats,
    newFiles,
    linesAdded: totalLines.added,
    linesDeleted: totalLines.deleted,
    codeReduction,
    judgeScore: judge.score,
    judgeThreshold: judge.threshold,
    runNumber: process.env.GITHUB_RUN_NUMBER || "local",
    runId: process.env.GITHUB_RUN_ID || "unknown",
    triggerEvent: process.env.GITHUB_EVENT_NAME || "manual",
  };

  const prTitle = generatePRTitle(prMetadata);
  const prBody = generatePRBody(prMetadata, report);

  fs.writeFileSync("pr-title.txt", prTitle);
  fs.writeFileSync("pr-body.txt", prBody);

  console.log(`✅ PR Title: ${prTitle}`);
  console.log("✅ PR message saved to pr-title.txt, pr-body.txt");

  console.log("\n" + "=".repeat(60));
  console.log("🎉 ops-department Auto Refactoring Complete!");
  writeRunStatus("success", "refactor_completed", {
    area: refactoringResult.area,
    filesModified: changedFiles.length,
    judgeScore: judge?.score,
  });
}

main().catch((error) => {
  console.error("❌ Fatal error:", error);
  writeRunStatus("failed", "fatal_error", {
    message: error.message,
  });
  process.exit(1);
});
