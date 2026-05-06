#!/usr/bin/env npx tsx

import { logHookExecution } from "../../lib/logging/hook-logger.js";

function buildSkillReminder() {
  return "Skills: Brainbaseの能力/プロジェクト表示/auth/31013/terminal系はbrainbase-capability-mapを入口にし、それ以外も関連skillがあれば先にSKILL.mdを読む。";
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
