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

    console.log(JSON.stringify({
      continue: false,
      suppressOutput: false,
      systemMessage: [
        "🛑 この変更はまだ確定されていません。",
        "",
        "現在の working copy は dirty ですが、jj の説明が `(no description set)` / `wip` のままです。",
        "この状態で終了すると、次の作業で上書き・消失しやすくなります。",
        "",
        "先に実行してください:",
        "- `/commit`",
        "- または `jj describe -m \"<type>: <summary>\"`",
        "- その後 `jj new`",
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
