#!/usr/bin/env npx tsx

/**
 * クイック通知スクリプト
 *
 * AIが簡単に呼び出せる短縮通知コマンド
 * 使用例: npx tsx .claude/scripts/hooks/quick-notify.ts "作業完了"
 */

import { execSync } from "child_process";

const message = process.argv[2] || "作業完了";

execSync(
  `npx tsx .claude/scripts/lib/notification/notifier.ts complete "${message}"`,
  {
    encoding: "utf8",
    stdio: "inherit",
  },
);
