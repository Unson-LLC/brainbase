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
    runGit(["rev-parse", "--is-inside-work-tree"]);
    return true;
  } catch {
    return false;
  }
}

function currentBranch(): string {
  try {
    return runGit(["branch", "--show-current"]);
  } catch {
    return "";
  }
}

function aheadCount(): number {
  try {
    const output = runGit(["rev-list", "--count", "origin/develop..HEAD"]);
    return Number.parseInt(output || "0", 10) || 0;
  } catch {
    return 0;
  }
}

async function main() {
  try {
    if (process.env.BRAINBASE_DISABLE_PUSH_GUARD === "1" || !isGitRepo()) {
      console.log(JSON.stringify({ continue: true, systemMessage: "", suppressOutput: true }));
      return;
    }

    const branch = currentBranch();
    const ahead = aheadCount();
    const blocked = branch === "develop" && ahead > 0;

    logHookExecution("Stop", "push-guard", `branch=${branch} ahead=${ahead} blocked=${blocked}`);

    if (!blocked) {
      console.log(JSON.stringify({ continue: true, systemMessage: "", suppressOutput: true }));
      return;
    }

    console.log(JSON.stringify({
      continue: false,
      suppressOutput: false,
      systemMessage: [
        "🛑 local commit が origin/develop へ未pushです。",
        "",
        "この repo では、明確に依頼された変更を終えたあとに `pushしますか？` と止まらず、develop へ反映まで終えるのが既定です。",
        "",
        "先に実行してください:",
        "- `git push origin develop`",
        "",
        "意図的に止める場合だけ `BRAINBASE_DISABLE_PUSH_GUARD=1` を使ってください。",
      ].join("\n"),
    }));
  } catch (error) {
    logHookExecution(
      "Stop",
      "push-guard",
      `error=${error instanceof Error ? error.message : String(error)}`,
    );
    console.log(JSON.stringify({ continue: true, systemMessage: "", suppressOutput: true }));
  }
}

void main();
