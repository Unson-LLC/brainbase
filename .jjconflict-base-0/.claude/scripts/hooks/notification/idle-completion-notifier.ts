#!/usr/bin/env npx tsx

/**
 * Notification Hook: 60秒アイドル時の作業完了検知フック（薄いラッパー）
 *
 * core/monitoring/idle-completion-detector.tsのエントリーポイント
 */

import { IdleCompletionDetector } from "../../core/monitoring/idle-completion-detector";
import type { NotificationHookInput } from "../../../../src/types/hooks/notification.js";

async function main(): Promise<void> {
  try {
    const detector = new IdleCompletionDetector();
    const input: NotificationHookInput = JSON.parse(
      process.env.HOOK_INPUT || "{}",
    );
    await detector.handleNotification(input);
  } catch (error) {
    console.error("Notification hook error:", error);
    // エラーでもプロセスは継続
  }
}

// 直接実行された場合
if (process.argv[1] === import.meta.url.replace("file://", "")) {
  main().catch(console.error);
}
