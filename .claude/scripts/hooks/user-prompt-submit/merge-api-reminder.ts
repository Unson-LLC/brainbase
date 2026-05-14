#!/usr/bin/env npx tsx

import { logHookExecution } from "../../lib/logging/hook-logger.js";

function buildMergeApiReminder() {
  return [
    "Brainbase merge rule: ユーザーが「マージして」「mergeして」と依頼し、対象がBrainbaseセッション/worktreeなら、raw gh/jj ではなくまず Brainbase API `POST http://localhost:31013/api/sessions/<session-id>/merge` を使う。",
    "session-id は `/api/state` の sessions[].path / sessions[].worktree.path と現在cwdを照合して特定する。",
    "APIが使えない例外時だけ raw gh/jj を使い、その場合も最後に 31013 の起動元、health、develop/origin/develop、必要な再起動を確認する。",
  ].join(" ");
}

async function main() {
  try {
    logHookExecution(
      "UserPromptSubmit",
      "merge-api-reminder",
      "Brainbase merge API 経路リマインドを注入",
    );
    console.log(JSON.stringify({
      continue: true,
      systemMessage: buildMergeApiReminder(),
      suppressOutput: true,
    }));
  } catch (error) {
    logHookExecution(
      "UserPromptSubmit",
      "merge-api-reminder",
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
