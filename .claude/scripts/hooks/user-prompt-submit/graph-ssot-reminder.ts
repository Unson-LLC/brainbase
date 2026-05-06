#!/usr/bin/env npx tsx

import { logHookExecution } from "../../lib/logging/hook-logger.js";

function buildGraphSsotReminder() {
  return "Graph SSOT: 固有名詞・プロジェクト・用語・意思決定を書く/変える前に brainbase-capability-map の graph.ssot を入口にする。";
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
