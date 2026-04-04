#!/usr/bin/env npx tsx

import { heartbeatClaudeTurn } from "../../core/monitoring/brainbase-activity-bridge.js";

async function main() {
  try {
    await heartbeatClaudeTurn(process.argv[2] || process.env.CLAUDE_TOOL_INPUT || "");
    process.exit(0);
  } catch (error) {
    console.error(
      "❌ Activity bridge(PostToolUse) 実行エラー:",
      error instanceof Error ? error.message : String(error),
    );
    process.exit(0);
  }
}

if (process.argv[1] === import.meta.url.replace("file://", "")) {
  main().catch((error) => {
    console.error("❌ フック実行エラー:", error);
    process.exit(0);
  });
}
