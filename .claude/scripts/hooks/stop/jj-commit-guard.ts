#!/usr/bin/env npx tsx

import { execFileSync } from "child_process";
import { logHookExecution } from "../../lib/logging/hook-logger.js";

function resolveJjBin(): string {
  const explicit = process.env.BRAINBASE_REAL_JJ_BIN;
  if (explicit && explicit.trim()) {
    return explicit.trim();
  }
  return "jj";
}

function runJj(args: string[]): string {
  return execFileSync(resolveJjBin(), args, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function isJjRepo(): boolean {
  try {
    runJj(["root"]);
    return true;
  } catch {
    return false;
  }
}

function getCurrentDescription(): string {
  try {
    return runJj(["log", "-r", "@", "--no-graph", "-T", "description.first_line() ++ \"\\n\""]);
  } catch {
    return "";
  }
}

function hasDirtyChanges(): boolean {
  try {
    return runJj(["diff", "--stat"]).replace(/\s+/g, "").length > 0;
  } catch {
    return false;
  }
}

function needsCheckpoint(description: string): boolean {
  const normalized = description.replace(/\r/g, "").trim();
  return (
    normalized === "" ||
    normalized === "(no description set)" ||
    normalized === "wip" ||
    normalized === "wip:" ||
    normalized.startsWith("wip: ")
  );
}

async function main() {
  try {
    if (!isJjRepo()) {
      console.log(JSON.stringify({ continue: true, systemMessage: "", suppressOutput: true }));
      return;
    }

    const dirty = hasDirtyChanges();
    const description = getCurrentDescription();
    const blocked = dirty && needsCheckpoint(description);

    logHookExecution(
      "Stop",
      "jj-commit-guard",
      `dirty=${dirty} description=${JSON.stringify(description)} blocked=${blocked}`,
    );

    if (!blocked) {
      console.log(JSON.stringify({ continue: true, systemMessage: "", suppressOutput: true }));
      return;
    }

    // ブロックせず自動チェックポイントを作成して続行を許可する
    try {
      runJj(["describe", "-m", "checkpoint: auto-saved by stop hook"]);
      logHookExecution("Stop", "jj-commit-guard", "auto-checkpoint created");
    } catch (describeError) {
      logHookExecution(
        "Stop",
        "jj-commit-guard",
        `auto-checkpoint failed: ${describeError instanceof Error ? describeError.message : String(describeError)}`,
      );
    }

    console.log(JSON.stringify({
      continue: true,
      suppressOutput: false,
      systemMessage: [
        "📌 working copy を自動チェックポイントしました。",
        "  jj describe -m \"checkpoint: auto-saved by stop hook\"",
        "次回作業時に jj describe で意味のある説明に書き換えてください。",
      ].join("\n"),
    }));
  } catch (error) {
    logHookExecution(
      "Stop",
      "jj-commit-guard",
      `error=${error instanceof Error ? error.message : String(error)}`,
    );
    console.log(JSON.stringify({ continue: true, systemMessage: "", suppressOutput: true }));
  }
}

void main();
