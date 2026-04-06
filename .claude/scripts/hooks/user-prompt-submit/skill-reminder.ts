#!/usr/bin/env npx tsx

import { logHookExecution } from "../../lib/logging/hook-logger.js";

function buildSkillReminder() {
  return "Skills: 関連skillがあれば先にSKILL.md読んで使う。なければ通常フロー。";
}

async function main() {
  try {
    logHookExecution("UserPromptSubmit", "skill-reminder", "skills 利用リマインドを注入");
    console.log(JSON.stringify({
      continue: true,
      systemMessage: buildSkillReminder(),
      suppressOutput: true,
    }));
  } catch (error) {
    logHookExecution("UserPromptSubmit", "skill-reminder", `エラー: ${error instanceof Error ? error.message : String(error)}`);
    console.log(JSON.stringify({
      continue: true,
      systemMessage: "",
      suppressOutput: true,
    }));
  }
}

void main();
