#!/usr/bin/env npx tsx

import { exec } from "child_process";
import { promisify } from "util";
import * as fs from "fs/promises";
import * as path from "path";

const execAsync = promisify(exec);

interface InterruptionNotification {
  type: "interrupted" | "completed" | "error";
  message: string;
  timestamp: string;
  context?: any;
}

class WorkInterruptionDetector {
  private logFile: string;

  constructor() {
    const logDir = path.join(process.cwd(), ".claude", "output", "logs");
    const dateStr = new Date().toISOString().split("T")[0];
    this.logFile = path.join(logDir, `interruption-${dateStr}.log`);
  }

  private async ensureLogDirectory(): Promise<void> {
    const logDir = path.dirname(this.logFile);
    await fs.mkdir(logDir, { recursive: true });
  }

  private async logNotification(
    notification: InterruptionNotification,
  ): Promise<void> {
    await this.ensureLogDirectory();
    const logEntry = `${notification.timestamp} [${notification.type.toUpperCase()}] ${notification.message}${
      notification.context
        ? "\nContext: " + JSON.stringify(notification.context, null, 2)
        : ""
    }\n`;
    await fs.appendFile(this.logFile, logEntry);
  }

  private async playSound(times: number = 1): Promise<void> {
    const soundCommands = [
      // macOS
      process.platform === "darwin" &&
        "afplay /System/Library/Sounds/Glass.aiff",
      // Windows
      process.platform === "win32" && "powershell -c [console]::beep(800,200)",
      // Linux
      process.platform === "linux" &&
        "paplay /usr/share/sounds/freedesktop/stereo/complete.oga",
    ].filter(Boolean);

    for (const cmd of soundCommands) {
      if (cmd) {
        for (let i = 0; i < times; i++) {
          try {
            await execAsync(cmd);
            if (i < times - 1) {
              await new Promise((resolve) => setTimeout(resolve, 500));
            }
          } catch {
            // 音声再生失敗は無視
          }
        }
        break;
      }
    }
  }

  private async speak(message: string): Promise<void> {
    const speakCommands = {
      darwin: `say -v Kyoko "${message}"`, // 日本語音声
      win32: `powershell -c "Add-Type -AssemblyName System.Speech; (New-Object System.Speech.Synthesis.SpeechSynthesizer).Speak('${message}')"`,
      linux: `espeak "${message}"`,
    };

    const command =
      speakCommands[process.platform as keyof typeof speakCommands];
    if (command) {
      try {
        await execAsync(command);
      } catch {
        // 音声読み上げ失敗は無視
      }
    }
  }

  public async notifyInterruption(
    reason: string = "ユーザーによる中断",
  ): Promise<void> {
    const notification: InterruptionNotification = {
      type: "interrupted",
      message: `作業が中断されました: ${reason}`,
      timestamp: new Date().toISOString(),
    };

    await this.logNotification(notification);

    // 3回音を鳴らす
    await this.playSound(3);

    // 日本語で通知
    await this.speak("作業が中断されました。次の指示をお待ちしています。");

    console.log("🛑 作業中断を検知しました");
    console.log(`📢 理由: ${reason}`);
    console.log("🔔 音声通知を送信しました");
    console.log(`📝 ログ保存先: ${this.logFile}`);
  }

  public async notifyCompletion(taskName: string): Promise<void> {
    const notification: InterruptionNotification = {
      type: "completed",
      message: `タスクが完了しました: ${taskName}`,
      timestamp: new Date().toISOString(),
    };

    await this.logNotification(notification);

    // 2回音を鳴らす
    await this.playSound(2);

    // 日本語で通知
    await this.speak(`${taskName}が完了しました。`);

    console.log("✅ タスク完了を通知しました");
    console.log(`📋 タスク: ${taskName}`);
  }

  public async notifyError(error: string): Promise<void> {
    const notification: InterruptionNotification = {
      type: "error",
      message: `エラーが発生しました: ${error}`,
      timestamp: new Date().toISOString(),
    };

    await this.logNotification(notification);

    // 4回音を鳴らす（エラーは重要）
    await this.playSound(4);

    // 日本語で通知
    await this.speak("エラーが発生しました。確認してください。");

    console.log("❌ エラーを通知しました");
    console.log(`🔴 エラー: ${error}`);
  }
}

// コマンドライン引数の処理
async function main() {
  const detector = new WorkInterruptionDetector();
  const [, , eventType, ...args] = process.argv;
  const message = args.join(" ");

  switch (eventType) {
    case "interrupted":
      await detector.notifyInterruption(message || "ユーザーによる中断");
      break;
    case "completed":
      await detector.notifyCompletion(message || "タスク");
      break;
    case "error":
      await detector.notifyError(message || "不明なエラー");
      break;
    default:
      // デフォルトは中断通知
      await detector.notifyInterruption("検知された中断");
  }
}

// エクスポート（他のスクリプトから使用可能）
export { WorkInterruptionDetector };

// 直接実行された場合
if (process.argv[1] === import.meta.url.replace("file://", "")) {
  main().catch(console.error);
}
