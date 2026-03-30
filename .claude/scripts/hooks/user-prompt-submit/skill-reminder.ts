#!/usr/bin/env npx tsx

import { logHookExecution } from "../../lib/logging/hook-logger.js";

function buildSkillReminder() {
  return [
    "## Skill Reminder",
    "- まず利用可能な skills を確認し、今回の依頼に関係する skill があれば先に使うこと。",
    "- 関連 skill がある場合は、対応する `SKILL.md` を読んでから計画・実装・回答に進むこと。",
    "- skill を使った場合は、短くどの skill を使ったか明示すること。",
    "- skill が見つからない場合だけ通常フローで続行すること。",
  ].join("\n");
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
