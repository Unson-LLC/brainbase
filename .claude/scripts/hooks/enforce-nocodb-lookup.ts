#!/usr/bin/env npx tsx

import { logHookExecution } from "../lib/logging/hook-logger.js";

function extractIssueIds(prompt: string): string[] {
  return [...new Set(prompt.match(/\b(?:FRD|REQ|BUG)-\d+\b/g) ?? [])].sort();
}

function buildSystemMessage(issueIds: string[]): string {
  return [
    `NocoDB lookup required for referenced issue IDs: ${issueIds.join(", ")}.`,
    "Before changing requirements, bugs, or implementation scope tied to these IDs, verify the canonical record in NocoDB or Graph SSOT and treat local memory as secondary.",
    "If the lookup tool is unavailable, state that explicitly and continue only with evidence from repo documents.",
  ].join(" ");
}

async function main() {
  const prompt = process.env.CLAUDE_USER_PROMPT ?? "";
  const issueIds = extractIssueIds(prompt);

  if (issueIds.length === 0) {
    console.log(JSON.stringify({
      continue: true,
      suppressOutput: true,
    }));
    return;
  }

  logHookExecution(
    "UserPromptSubmit",
    "enforce-nocodb-lookup",
    `issue ids: ${issueIds.join(", ")}`,
  );

  console.log(JSON.stringify({
    continue: true,
    systemMessage: buildSystemMessage(issueIds),
    suppressOutput: true,
  }));
}

void main().catch((error) => {
  logHookExecution(
    "UserPromptSubmit",
    "enforce-nocodb-lookup",
    `error: ${error instanceof Error ? error.message : String(error)}`,
  );
  console.log(JSON.stringify({
    continue: true,
    suppressOutput: true,
  }));
});
