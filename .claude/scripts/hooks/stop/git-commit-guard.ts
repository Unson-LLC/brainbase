#!/usr/bin/env npx tsx

import { execFileSync } from "child_process";
import { logHookExecution } from "../../lib/logging/hook-logger.js";

function runGit(args: string[]): string {
  return execFileSync("git", args, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function isGitRepo(): boolean {
  try {
    runGit(["rev-parse", "--git-dir"]);
    return true;
  } catch {
    return false;
  }
}

const ARTIFACT_PREFIXES = [".claude/", "node_modules/"];
const ARTIFACT_BASENAMES = new Set([
  ".DS_Store",
  ".brainbase-port",
  ".mcp.json",
  "AGENTS.md",
  "CLAUDE.md",
]);

function isArtifactPath(statusPath: string): boolean {
  const normalized = statusPath.replace(/^"|"$/g, "");
  if (ARTIFACT_PREFIXES.some((prefix) => normalized.startsWith(prefix))) {
    return true;
  }
  const basename = normalized.split("/").pop() ?? normalized;
  return ARTIFACT_BASENAMES.has(basename);
}

function getDirtyPaths(): string[] {
  try {
    return runGit(["status", "--porcelain"])
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => line.slice(3).replace(/^.* -> /, ""))
      .filter((statusPath) => !isArtifactPath(statusPath));
  } catch {
    return [];
  }
}

async function main() {
  try {
    if (!isGitRepo()) {
      console.log(JSON.stringify({ continue: true, systemMessage: "", suppressOutput: true }));
      return;
    }

    const dirtyPaths = getDirtyPaths();
    logHookExecution(
      "Stop",
      "git-commit-guard",
      `dirty=${dirtyPaths.length > 0} paths=${JSON.stringify(dirtyPaths.slice(0, 10))}`,
    );

    if (dirtyPaths.length === 0) {
      console.log(JSON.stringify({ continue: true, systemMessage: "", suppressOutput: true }));
      return;
    }

    // 自動コミットはしない（git add -A 禁止ポリシーと整合）。未コミット変更を明示して続行する。
    console.log(JSON.stringify({
      continue: true,
      suppressOutput: false,
      systemMessage: [
        `📌 未コミットの変更が ${dirtyPaths.length} 件あります:`,
        ...dirtyPaths.slice(0, 10).map((p) => `  - ${p}`),
        "意図が確定している変更は、対象ファイルを明示して git add / git commit してください。",
      ].join("\n"),
    }));
  } catch (error) {
    logHookExecution(
      "Stop",
      "git-commit-guard",
      `error=${error instanceof Error ? error.message : String(error)}`,
    );
    console.log(JSON.stringify({ continue: true, systemMessage: "", suppressOutput: true }));
  }
}

void main();
