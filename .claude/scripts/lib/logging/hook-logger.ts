/**
 * フックログ出力ユーティリティ
 */
import * as fs from "fs";
import * as path from "path";

/**
 * フックのログを記録
 *
 * @param hookType フックタイプ（例: "UserPromptSubmit", "PreToolUse"）
 * @param action 実行したアクション（状態として記録される）
 * @param details 詳細情報（オプション）
 */
export function logHookExecution(
  hookType: string,
  action: string,
  details?: string,
): void {
  try {
    const timestamp = new Date().toISOString();
    const dateStr = timestamp.split("T")[0]; // YYYY-MM-DD

    // notification.logと同じフォーマット: [状態] メッセージ
    const status = action.toUpperCase();
    const message = details ? `${hookType}: ${details}` : hookType;
    const logMessage = `${timestamp} [${status}] ${message}\n`;

    // .claude/output/logs/ディレクトリの確保
    const logsDir = path.join(process.cwd(), ".claude", "output", "logs");
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }

    // hookTypeごとにログファイルを分ける
    const logFileName = hookType.toLowerCase().replace(/([a-z])([A-Z])/g, '$1-$2');
    const logFile = path.join(logsDir, `${logFileName}-${dateStr}.log`);
    fs.appendFileSync(logFile, logMessage);
  } catch (error) {
    // ログ出力エラーは無視（フック実行を妨げない）
    console.error(`[Hook Logger Error] ${error}`);
  }
}
