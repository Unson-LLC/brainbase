#!/usr/bin/env ts-node

/**
 * 危険コマンドチェッカー (TypeScript版)
 * Claude Code の pre-bash フック用
 *
 * データ損失を防ぐため、危険なコマンドの実行を阻止する
 */

import { exec } from "child_process";
import { promisify } from "util";
import type {
  CommandPattern,
  CheckResult,
} from "../../../../src/types/hooks/command-checker.js";

const execAsync = promisify(exec);

const forbiddenCommands: CommandPattern[] = [
  // データベース破壊コマンド
  {
    pattern: "prisma migrate reset",
    reason: "データベース全体をリセットし、全データが削除される",
  },
  {
    pattern: "prisma db push --reset",
    reason: "スキーマを強制適用し、既存データが削除される",
  },
  { pattern: "DROP DATABASE", reason: "データベース全体が削除される" },
  { pattern: "TRUNCATE TABLE", reason: "テーブル内の全データが削除される" },
  { pattern: "DELETE FROM", reason: "大量のデータが削除される可能性がある" },

  // ファイルシステム破壊コマンド
  { pattern: "rm -rf /", reason: "システム全体が削除される" },
  {
    pattern: "rm -rf *",
    reason: "カレントディレクトリの全ファイルが削除される",
  },
  { pattern: "rm -rf .", reason: "カレントディレクトリが削除される" },
  { pattern: "rm -rf ./", reason: "カレントディレクトリが削除される" },
  { pattern: "rm -rf ../", reason: "親ディレクトリが削除される" },

  // Git 危険操作
  {
    pattern: "git add .",
    reason: "不要ファイルを含む全ファイルがステージングされる（個別指定必須）",
  },
  {
    pattern: "git add -A",
    reason: "不要ファイルを含む全ファイルがステージングされる（個別指定必須）",
  },
  {
    pattern: "git add --all",
    reason: "不要ファイルを含む全ファイルがステージングされる（個別指定必須）",
  },
  { pattern: "git reset --hard", reason: "作業内容が完全に失われる" },
  { pattern: "git clean -fdx", reason: "未追跡ファイルが全て削除される" },

  // その他の危険コマンド
  { pattern: "docker-compose down -v", reason: "Dockerボリュームが削除される" },
  {
    pattern: "docker system prune -a",
    reason: "全てのDockerリソースが削除される",
  },
];

const warningCommands: CommandPattern[] = [
  // 注意が必要だが条件付きで許可
  { pattern: "prisma migrate dev", reason: "データベーススキーマが変更される" },
  { pattern: "npm run build", reason: "ビルド処理が実行される" },
  {
    pattern: "git push --force",
    reason: "リモートリポジトリの履歴が書き換えられる",
  },
  {
    pattern: "cd ",
    reason:
      "カレントディレクトリ変更はフック実行エラーの原因になります（絶対パス使用を推奨）",
  },
];

export class CommandChecker {
  /**
   * システム通知を表示
   */
  private async showNotification(
    title: string,
    message: string,
  ): Promise<void> {
    try {
      await execAsync(
        `osascript -e 'display notification "${message}" with title "${title}"'`,
      );
    } catch (error) {
      // 通知エラーは無視（開発環境によってはサポートされていない）
    }
  }

  /**
   * システム音を再生
   */
  private async playSound(): Promise<void> {
    try {
      await execAsync("afplay /System/Library/Sounds/Glass.aiff");
    } catch (error) {
      // 音声再生エラーは無視
    }
  }

  /**
   * 音声読み上げ
   */
  private async speak(text: string): Promise<void> {
    try {
      await execAsync(`say -v Kyoko "${text}"`);
    } catch (error) {
      // 音声読み上げエラーは無視
    }
  }
  private normalizeCommand(command: string): string {
    return command.trim().toLowerCase();
  }

  private checkForbiddenCommands(command: string): CheckResult {
    const normalizedCommand = this.normalizeCommand(command);

    for (const forbidden of forbiddenCommands) {
      if (normalizedCommand.includes(forbidden.pattern.toLowerCase())) {
        return {
          allowed: false,
          message: `禁止パターン: "${forbidden.pattern}" - ${forbidden.reason}`,
        };
      }
    }

    return { allowed: true };
  }

  private checkWarningCommands(command: string): CheckResult {
    const normalizedCommand = this.normalizeCommand(command);

    for (const warning of warningCommands) {
      if (normalizedCommand.includes(warning.pattern.toLowerCase())) {
        return {
          allowed: true,
          isWarning: true,
          message: `警告パターン: "${warning.pattern}" - ${warning.reason}`,
        };
      }
    }

    return { allowed: true };
  }

  private checkSpecialCases(command: string): CheckResult {
    const normalizedCommand = this.normalizeCommand(command);

    // 特別なケース: migrate reset の変形パターン
    if (
      normalizedCommand.includes("migrate") &&
      (normalizedCommand.includes("reset") ||
        normalizedCommand.includes("--force"))
    ) {
      return {
        allowed: false,
        message:
          "データベースマイグレーションリセットは全てのデータを削除します",
      };
    }

    return { allowed: true };
  }

  public checkCommand(command: string): CheckResult {
    // 禁止コマンドチェック
    const forbiddenResult = this.checkForbiddenCommands(command);
    if (!forbiddenResult.allowed) {
      return forbiddenResult;
    }

    // 特別ケースチェック
    const specialResult = this.checkSpecialCases(command);
    if (!specialResult.allowed) {
      return specialResult;
    }

    // 警告コマンドチェック
    const warningResult = this.checkWarningCommands(command);
    return warningResult;
  }

  public async displayError(command: string, message: string): Promise<void> {
    console.error("🚨 ============================================");
    console.error("🚨 危険なコマンドが検出されました！");
    console.error("🚨 ============================================");
    console.error(`コマンド: ${command}`);
    console.error(`理由: ${message}`);
    console.error("");
    console.error("このコマンドは以下の理由で明示的に禁止されています:");
    console.error("- データ損失の防止");
    console.error("- 意図しないシステム損傷の防止");
    console.error("- 取り返しのつかない操作の防止");
    console.error("");
    console.error("詳細は FORBIDDEN_COMMANDS.md をご確認ください。");
    console.error("🚨 ============================================");

    // 危険コマンドブロック通知
    await this.showNotification(
      "🚨 危険コマンドブロック",
      `危険なコマンドをブロックしました: ${command}`,
    );
    await this.playSound();
    await this.speak(
      "危険なコマンドをブロックしました。安全のため実行を停止します。",
    );
  }

  public displayWarning(command: string, message: string): void {
    console.warn("⚠️  警告: 潜在的に危険なコマンドが検出されました");
    console.warn(`コマンド: ${command}`);
    console.warn(`詳細: ${message}`);
    console.warn("実行前にユーザーの確認を取ってください。");
    console.warn("");
  }

  public displaySuccess(): void {
    console.log("✅ コマンド安全性チェック通過");
  }
}

// このファイルはコアロジックのみを提供
// エントリーポイントは forbidden-commands-wrapper.ts
