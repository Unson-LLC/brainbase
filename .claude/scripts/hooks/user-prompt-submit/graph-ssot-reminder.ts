#!/usr/bin/env npx tsx

import { logHookExecution } from "../../lib/logging/hook-logger.js";

function buildGraphSsotReminder() {
  return [
    "Graph SSOT (bb.unson.jp): 人物/組織/顧客/パートナー/プロジェクト/用語/意思決定等の正本。固有名詞や事実を書く前に Graph を一次情報として確認する。",
    "Graph操作・Graph参照では brainbase MCP の get_context/list_entities/get_entity/search を優先し、返答先頭の Brainbase Philosophy Context を CLAUDE.md 的な判断前提として扱う。MCP Graph系ツールは includePhilosophy=false を明示しない限り思想contextを注入する。",
    "curlで直接確認する場合は必ず Authorization / x-brainbase-role / x-brainbase-projects / x-brainbase-clearance を付ける。例: TOKEN=$(cat ~/.brainbase/tokens.json | jq -r .access_token); curl -sS -H \"Authorization: Bearer $TOKEN\" -H \"x-brainbase-role: gm\" -H \"x-brainbase-projects: brainbase,unson,salestailor\" -H \"x-brainbase-clearance: internal,restricted,finance,hr,contract\" \"https://bb.unson.jp/api/info/graph/entities?type=<type>&limit=500\" | jq 'if .error then error(.error) else . end'。type: person/org/customer/partner/project/app/brand/frame/philosophy/glossary_term/decision/story/raci_assignment/contact。",
    "Graph APIの.errorや非2xxは検索失敗であり、空結果や未登録として扱わない。",
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
