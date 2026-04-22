#!/usr/bin/env npx tsx

import { logHookExecution } from "../../lib/logging/hook-logger.js";

function buildGraphSsotReminder() {
  return "Graph SSOT (bb.unson.jp): 人物/組織/顧客/パートナー/プロジェクト/用語/意思決定等の正本。固有名詞や事実を書く前に curl -H 'Authorization: Bearer $(cat ~/.brainbase/tokens.json | jq -r .access_token)' 'https://bb.unson.jp/api/info/graph/entities?type=<type>&limit=500' で確認。type: person/org/customer/partner/project/app/brand/frame/glossary_term/decision/story/raci_assignment/contact。議事録・memory・推測は参考値、Graphと不一致ならGraphを優先。";
}

async function main() {
  try {
    logHookExecution("UserPromptSubmit", "graph-ssot-reminder", "Graph SSOT 参照リマインドを注入");
    console.log(JSON.stringify({
      continue: true,
      systemMessage: buildGraphSsotReminder(),
      suppressOutput: true,
    }));
  } catch (error) {
    logHookExecution(
      "UserPromptSubmit",
      "graph-ssot-reminder",
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
