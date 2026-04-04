#!/usr/bin/env npx tsx

import { startClaudeTurn } from "../../core/monitoring/brainbase-activity-bridge.js";

async function main() {
  try {
    await startClaudeTurn(process.env.CLAUDE_USER_PROMPT || "");
    console.log(JSON.stringify({
      continue: true,
      systemMessage: "",
      suppressOutput: true,
    }));
  } catch (error) {
    console.error(
      "❌ Activity bridge(UserPromptSubmit) 実行エラー:",
      error instanceof Error ? error.message : String(error),
    );
    console.log(JSON.stringify({
      continue: true,
      systemMessage: "",
      suppressOutput: true,
    }));
  }
}

void main();
