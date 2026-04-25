#!/usr/bin/env npx tsx

import { logHookExecution } from "../../lib/logging/hook-logger.js";

function buildGraphSsotReminder() {
  return [
    "Graph SSOT (bb.unson.jp): 人物/組織/顧客/パートナー/プロジェクト/用語/意思決定等の正本。固有名詞や事実を書く前に Graph を一次情報として確認する。",
    "Graph操作・Graph参照では brainbase MCP の get_context/list_entities/get_entity/search を優先し、返答先頭の Brainbase Philosophy Context を CLAUDE.md 的な判断前提として扱う。MCP Graph系ツールは includePhilosophy=false を明示しない限り思想contextを注入する。",
    "curlで直接確認する場合: curl -H 'Authorization: Bearer $(cat ~/.brainbase/tokens.json | jq -r .access_token)' 'https://bb.unson.jp/api/info/graph/entities?type=<type>&limit=500'。type: person/org/customer/partner/project/app/brand/frame/philosophy/glossary_term/decision/story/raci_assignment/contact。",
    "議事録・memory・推測は参考値、Graphと不一致ならGraphを優先。",
  ].join(" ");
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
