#!/usr/bin/env npx tsx

/**
 * PostToolUse 作業中断検知フック（薄いラッパー）
 *
 * core/monitoring/post-tool-monitor.tsのエントリーポイント
 */

import { PostToolMonitor } from "../../core/monitoring/post-tool-monitor";

// モニター初期化
const monitor = new PostToolMonitor();
monitor.setupSignalHandlers();

// Hook entry point
if (process.argv[1] === import.meta.url.replace("file://", "")) {
  const input = JSON.parse(process.env.HOOK_INPUT || "{}");
  monitor.handle(input).catch(console.error);
}
