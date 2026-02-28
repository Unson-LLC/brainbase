#!/usr/bin/env tsx

/**
 * Manual Notification Helper
 *
 * 重要なタスク完了時に明示的に通知を送信するヘルパー関数
 * Claude Codeの自動フック実行が不安定なため、確実な通知のために使用
 */

import { execSync } from "child_process";
import * as fs from "fs";

/**
 * 通知種別
 */
import type { NotificationType } from "../../../../src/types/hooks/notification.js";

/**
 * 音声設定
 */
const VOICE_CONFIG = {
  voice: "Kyoko",
  speed: 300, // wpm
};

/**
 * 通知音ファイル
 */
const SOUND_FILES = {
  complete: "/System/Library/Sounds/Glass.aiff",
  warning: "/System/Library/Sounds/Sosumi.aiff",
  error: "/System/Library/Sounds/Basso.aiff",
  info: "/System/Library/Sounds/Ping.aiff",
};

/**
 * 通知メッセージを送信
 */
async function sendNotification(
  type: NotificationType,
  message: string,
): Promise<void> {
  try {
    console.log(`🔔 Manual Notification: ${message}`);

    // macOS通知の送信
    const osascriptCommand = `osascript -e 'display notification "${message}" with title "Claude Code Manual Notification" sound name "Glass"'`;
    execSync(osascriptCommand, { stdio: "ignore" });

    // 音声通知の送信
    const speechCommand = `say -v ${VOICE_CONFIG.voice} -r ${VOICE_CONFIG.speed} "${message}"`;
    execSync(speechCommand, { stdio: "ignore" });

    // ログファイルに記録（日付別）
    const timestamp = new Date().toISOString();
    const dateStr = timestamp.split("T")[0]; // YYYY-MM-DD
    const logEntry = `${timestamp} [${type.toUpperCase()}] ${message}\n`;

    // .claude/output/logs/ディレクトリの確保
    const logsDir = ".claude/output/logs";
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }

    const logFile = `${logsDir}/notification-${dateStr}.log`;
    fs.appendFileSync(logFile, logEntry);
  } catch (error) {
    console.error("❌ 通知送信に失敗:", error);
  }
}

/**
 * タスク完了通知
 */
export async function notifyTaskComplete(taskName: string): Promise<void> {
  const message = `タスク完了: ${taskName}`;
  await sendNotification("complete", message);
}

/**
 * エラー通知
 */
export async function notifyError(errorMessage: string): Promise<void> {
  const message = `エラー発生: ${errorMessage}`;
  await sendNotification("error", message);
}

/**
 * 警告通知
 */
export async function notifyWarning(warningMessage: string): Promise<void> {
  const message = `警告: ${warningMessage}`;
  await sendNotification("warning", message);
}

/**
 * 情報通知
 */
export async function notifyInfo(infoMessage: string): Promise<void> {
  await sendNotification("info", infoMessage);
}

/**
 * 複数タスク完了通知
 */
export async function notifyMultipleTasksComplete(
  tasks: string[],
): Promise<void> {
  if (tasks.length === 0) return;

  if (tasks.length === 1) {
    await notifyTaskComplete(tasks[0]);
    return;
  }

  const message = `${tasks.length}個のタスクが完了しました: ${tasks.join(", ")}`;
  await sendNotification("complete", message);
}

/**
 * コミット完了通知（git情報を含む）
 */
export async function notifyCommitComplete(): Promise<void> {
  try {
    const commitHash = execSync("git rev-parse --short HEAD", {
      encoding: "utf8",
    }).trim();
    const commitMessage = execSync("git log -1 --pretty=%s", {
      encoding: "utf8",
    }).trim();
    const branch = execSync("git branch --show-current", {
      encoding: "utf8",
    }).trim();

    const message = `コミット完了: ${commitHash} on ${branch} - ${commitMessage}`;
    await sendNotification("complete", message);
  } catch (error) {
    await notifyTaskComplete("Git コミット");
  }
}

/**
 * プッシュ完了通知
 */
export async function notifyPushComplete(): Promise<void> {
  try {
    const branch = execSync("git branch --show-current", {
      encoding: "utf8",
    }).trim();
    const message = `プッシュ完了: ${branch}ブランチをリモートに送信しました`;
    await sendNotification("complete", message);
  } catch (error) {
    await notifyTaskComplete("Git プッシュ");
  }
}

/**
 * CLI実行用メイン関数
 */
async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log(
      "Usage: npx tsx .claude/manual-notification.ts <type> <message>",
    );
    console.log("Types: complete, warning, error, info, commit, push");
    process.exit(1);
  }

  const [type, ...messageParts] = args;
  const message = messageParts.join(" ");

  switch (type) {
    case "complete":
      await notifyTaskComplete(message);
      break;
    case "warning":
      await notifyWarning(message);
      break;
    case "error":
      await notifyError(message);
      break;
    case "info":
      await notifyInfo(message);
      break;
    case "commit":
      await notifyCommitComplete();
      break;
    case "push":
      await notifyPushComplete();
      break;
    default:
      console.error(`Unknown notification type: ${type}`);
      process.exit(1);
  }
}

// CLI実行時
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}
