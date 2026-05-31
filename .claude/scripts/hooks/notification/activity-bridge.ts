#!/usr/bin/env npx tsx

import { notifyClaudeWaiting } from "../../core/monitoring/brainbase-activity-bridge.js";

// Claude Code は Notification hook の payload を stdin(JSON) で渡す。
// 例: { session_id, hook_event_name:"Notification", notification_type, message }
function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) {
      resolve("");
      return;
    }
    let data = "";
    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", () => resolve(data));
    // セーフティ: stdin が来なくても hook をブロックしない
    setTimeout(() => resolve(data), 800);
  });
}

async function main() {
  try {
    const payload = await readStdin();
    await notifyClaudeWaiting(payload || process.argv[2] || "");
    process.exit(0);
  } catch (error) {
    console.error(
      "❌ Activity bridge(Notification) 実行エラー:",
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
