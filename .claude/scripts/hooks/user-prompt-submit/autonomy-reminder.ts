#!/usr/bin/env npx tsx

import { logHookExecution } from "../../lib/logging/hook-logger.js";

function buildAutonomyReminder() {
  return [
    "## Autonomy Reminder",
    "- routine な実行は確認せず進めること。",
    "- 特に、明確に依頼された変更の commit / push / server restart / local verification は、別確認を取らず end-to-end で完了させること。",
    "- ユーザーへ確認を返してよいのは、破壊的操作・不可逆な外部作用・要件の曖昧さがある場合だけ。",
    "- `必要なら〜します` で止めず、明確に含意されている作業は実行すること。",
  ].join("\n");
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
