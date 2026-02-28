/**
 * PostToolUse モニタリングシステム
 *
 * AIツール実行後の監視とユーザー通知
 * - ツール実行完了通知
 * - エラー検知と通知
 * - タスク完了の自動検知
 */

import { WorkInterruptionDetector } from "./interrupt-detector";

interface HookInput {
  tool: string;
  output?: any;
  error?: any;
}

/**
 * PostToolUseモニタークラス
 */
export class PostToolMonitor {
  private detector: WorkInterruptionDetector;

  constructor() {
    this.detector = new WorkInterruptionDetector();
  }

  /**
   * PostToolUse処理
   */
  async handle(input: HookInput): Promise<void> {
    // エラーが発生した場合
    if (input.error) {
      await this.detector.notifyError(
        input.error.message || "ツール実行エラー",
      );
      return;
    }

    // Bashコマンドの場合、重要なコマンドの完了を通知
    if (input.tool === "Bash" && input.output) {
      const importantCommands = [
        "git commit",
        "git push",
        "npm test",
        "npm run build",
      ];
      const command = input.output.command || "";
      if (importantCommands.some((cmd) => command.includes(cmd))) {
        await this.detector.notifyCompletion(
          `コマンド: ${command.substring(0, 50)}`,
        );
      }
    }
  }

  /**
   * SIGINT/SIGTERM処理のセットアップ
   */
  setupSignalHandlers(): void {
    // SIGINT（Ctrl+C）や中断シグナルを検知
    process.on("SIGINT", async () => {
      await this.detector.notifyInterruption("ユーザーによる強制終了");
      process.exit(0);
    });

    process.on("SIGTERM", async () => {
      await this.detector.notifyInterruption("プロセスの終了");
      process.exit(0);
    });
  }
}
