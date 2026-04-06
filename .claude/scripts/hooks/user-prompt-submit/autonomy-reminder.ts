#!/usr/bin/env npx tsx

import { logHookExecution } from "../../lib/logging/hook-logger.js";

function buildAutonomyReminder() {
  return "Autonomy: commit/push/restart等のroutineは確認不要で実行。破壊的・不可逆・曖昧な場合のみ確認。";
}

async function main() {
  try {
    logHookExecution("UserPromptSubmit", "autonomy-reminder", "不要確認防止の方針を注入");
    console.log(JSON.stringify({
      continue: true,
      systemMessage: buildAutonomyReminder(),
      suppressOutput: true,
    }));
  } catch (error) {
    logHookExecution(
      "UserPromptSubmit",
      "autonomy-reminder",
      `エラー: ${error instanceof Error ? error.message : String(error)}`,
    );
    console.log(JSON.stringify({
      continue: true,
      systemMessage: "",
      suppressOutput: true,
    }));
  }
}

void main();
