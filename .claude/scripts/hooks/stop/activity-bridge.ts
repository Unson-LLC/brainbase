#!/usr/bin/env npx tsx

import { completeClaudeTurn } from "../../core/monitoring/brainbase-activity-bridge.js";

async function main() {
  try {
    await completeClaudeTurn();
    process.exit(0);
  } catch (error) {
    console.error(
      "❌ Activity bridge(Stop) 実行エラー:",
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
