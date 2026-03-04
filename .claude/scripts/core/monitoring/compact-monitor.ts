#!/usr/bin/env npx tsx

/**
 * コンパクト処理監視システム
 *
 * Claude Codeのコンパクト処理（会話履歴圧縮）を検知し、
 * CLAUDE.mdファイルの再読み込み状況を監視・報告します。
 */

import * as fs from "fs/promises";
import * as path from "path";

/**
 * コンパクト処理監視クラス
 */
class CompactMonitor {
  private logFile: string;
  private claudeFile: string;
  private lastModified: number = 0;

  constructor() {
    const logDir = path.join(process.cwd(), ".claude", "output", "logs");
    const dateStr = new Date().toISOString().split("T")[0];
    this.logFile = path.join(logDir, `compact-monitor-${dateStr}.log`);
    this.claudeFile = path.join(process.cwd(), "CLAUDE.md");
  }

  /**
   * コンパクト処理の監視を開始します。
   */
  public async startMonitoring(): Promise<void> {
    try {
      // CLAUDE.mdの初期状態を記録
      await this.recordInitialState();

      // メッセージの長さやセッション状態の変化を監視
      await this.checkForCompact();
    } catch (error) {
      console.error("コンパクト監視エラー:", error);
    }
  }

  /**
   * CLAUDE.mdファイルの初期状態を記録します。
   */
  private async recordInitialState(): Promise<void> {
    try {
      const stats = await fs.stat(this.claudeFile);
      this.lastModified = stats.mtime.getTime();

      const logEntry = `${new Date().toISOString()} - 初期状態記録: CLAUDE.md最終変更 ${stats.mtime.toISOString()}\n`;
      await this.writeLog(logEntry);
    } catch (error) {
      console.warn("CLAUDE.md状態記録に失敗:", error);
    }
  }

  /**
   * コンパクト処理の発生をチェックします。
   */
  private async checkForCompact(): Promise<void> {
    // セッション長の推定（単純な目安）
    const sessionLength = process.hrtime.bigint() - process.hrtime.bigint();

    // 長いセッションの場合、コンパクト処理の可能性をログ記録
    const logEntry = `${new Date().toISOString()} - セッション継続中 (コンパクト処理監視中)\n`;
    await this.writeLog(logEntry);

    // CLAUDE.mdの変更検知
    await this.checkCLAUDEModification();
  }

  /**
   * CLAUDE.mdファイルの変更を検知します。
   */
  private async checkCLAUDEModification(): Promise<void> {
    try {
      const stats = await fs.stat(this.claudeFile);
      const currentModified = stats.mtime.getTime();

      if (currentModified > this.lastModified) {
        // CLAUDE.mdが更新された場合
        const logEntry = `${new Date().toISOString()} - 🔄 CLAUDE.md更新検知: ${stats.mtime.toISOString()}\n`;
        await this.writeLog(logEntry);

        // コンパクト処理後の再読み込み可能性を記録
        const compactEntry = `${new Date().toISOString()} - 📋 可能性: コンパクト処理による再読み込み\n`;
        await this.writeLog(compactEntry);

        this.lastModified = currentModified;
      }
    } catch (error) {
      console.warn("CLAUDE.md変更検知エラー:", error);
    }
  }

  /**
   * ログファイルに書き込みます。
   */
  private async writeLog(entry: string): Promise<void> {
    try {
      const logDir = path.dirname(this.logFile);
      await fs.mkdir(logDir, { recursive: true });
      await fs.appendFile(this.logFile, entry);
    } catch (error) {
      console.warn("ログ書き込みエラー:", error);
    }
  }

  /**
   * 現在の監視状況をレポートします。
   */
  public async generateReport(): Promise<string> {
    try {
      const logContent = await fs.readFile(this.logFile, "utf8");
      const lines = logContent.split("\n").filter(Boolean);

      let report = "\n📊 コンパクト処理監視レポート\n";
      report += "=".repeat(50) + "\n";

      if (lines.length === 0) {
        report += "📝 監視ログがありません\n";
        return report;
      }

      // 最近の10件のログを表示
      const recentLogs = lines.slice(-10);
      for (const log of recentLogs) {
        report += `${log}\n`;
      }

      // CLAUDE.md更新の有無を確認
      const hasUpdate = lines.some((line) =>
        line.includes("CLAUDE.md更新検知"),
      );
      if (hasUpdate) {
        report += "\n🔄 CLAUDE.mdの更新が検知されました！\n";
        report += "💡 コンパクト処理による再読み込みの可能性があります。\n";
      } else {
        report += "\n📝 CLAUDE.mdの更新は検知されていません。\n";
      }

      return report;
    } catch (error) {
      return `❌ レポート生成エラー: ${error}`;
    }
  }
}

/**
 * メイン処理
 */
async function main(): Promise<void> {
  const monitor = new CompactMonitor();

  // 監視開始
  await monitor.startMonitoring();

  // レポート生成（オプション）
  if (process.argv.includes("--report")) {
    const report = await monitor.generateReport();
    console.log(report);
  }
}

// 直接実行された場合
if (process.argv[1] === import.meta.url.replace("file://", "")) {
  main().catch(console.error);
}
