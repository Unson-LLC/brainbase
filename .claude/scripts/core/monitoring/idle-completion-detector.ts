/**
 * 60秒アイドル時の作業完了検知・通知システム
 *
 * Claude Codeが60秒間アイドル状態になった際に、作業完了を検知し音声通知を送信します。
 */

import { WorkInterruptionDetector } from "./interrupt-detector";
import type { NotificationHookInput } from "../../../../src/types/hooks/notification.js";

/**
 * アイドル状態での作業完了検知クラス
 */
export class IdleCompletionDetector {
  private detector: WorkInterruptionDetector;

  constructor() {
    this.detector = new WorkInterruptionDetector();
  }

  /**
   * 入力が60秒アイドル通知かどうかを判定
   */
  private isIdleNotification(input: NotificationHookInput): boolean {
    const message = input.message?.toLowerCase() || "";
    return (
      message.includes("waiting for your input") ||
      message.includes("アイドル") ||
      message.includes("idle")
    );
  }

  /**
   * 入力がツール使用許可要求かどうかを判定
   */
  private isToolPermissionRequest(input: NotificationHookInput): boolean {
    const message = input.message?.toLowerCase() || "";
    return message.includes("permission") || message.includes("許可");
  }

  /**
   * 60秒アイドル状態時の処理を実行
   */
  private async handleIdleState(input: NotificationHookInput): Promise<void> {
    try {
      // 作業完了と判断し、音声通知を送信
      await this.detector.notifyCompletion(
        "60秒アイドル状態により作業完了と判定",
      );

      // ログ出力
      console.log("🕒 60秒アイドル状態を検知");
      console.log("✅ 作業完了通知を送信しました");
      console.log("📅 セッションID:", input.session_id || "unknown");

      // ログ記録
      await this.logIdleCompletion(input);
    } catch (error) {
      console.error("アイドル状態処理中にエラーが発生:", error);
      await this.detector.notifyError("アイドル状態処理エラー");
    }
  }

  /**
   * アイドル状態での作業完了をログに記録
   */
  private async logIdleCompletion(input: NotificationHookInput): Promise<void> {
    const timestamp = new Date().toISOString();
    const logEntry = `${timestamp} - 60秒アイドル状態により作業完了通知送信 (Session: ${input.session_id})\n`;

    try {
      const fs = await import("fs/promises");
      const path = await import("path");

      const logDir = path.join(process.cwd(), ".claude", "output", "logs");
      const dateStr = new Date().toISOString().split("T")[0];
      const logFile = path.join(logDir, `idle-completion-${dateStr}.log`);

      await fs.mkdir(logDir, { recursive: true });
      await fs.appendFile(logFile, logEntry);
    } catch (error) {
      console.error("ログ記録エラー:", error);
    }
  }

  /**
   * Notificationフックの入力を解析し、60秒アイドル時の処理を実行
   */
  public async handleNotification(input: NotificationHookInput): Promise<void> {
    // 60秒アイドル状態の検知
    if (this.isIdleNotification(input)) {
      await this.handleIdleState(input);
    }
    // ツール許可要求の場合（必要に応じて処理追加可能）
    else if (this.isToolPermissionRequest(input)) {
      // 現在は何もしない（将来的に拡張可能）
      console.log("Tool permission requested:", input.message);
    }
  }
}
