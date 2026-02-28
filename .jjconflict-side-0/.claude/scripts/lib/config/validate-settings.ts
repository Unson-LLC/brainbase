#!/usr/bin/env tsx

/**
 * Settings.json検証スクリプト
 *
 * 設定変更時に必須機能が維持されていることを確認
 * このスクリプトは設定変更前後で実行し、機能の欠落を防ぐ
 */

import * as fs from "fs";
import * as path from "path";

import type { ValidationResult } from "../../../../src/types/claude-hooks.js";

/**
 * 必須スクリプト一覧（絶対に削除してはいけない）
 */
const CRITICAL_SCRIPTS = [
  "forbidden-commands.ts", // 危険コマンドブロック
  "pre-commit-verification.ts", // コミット前検証
  "pr-create-verification.ts", // PR作成前検証
  "notifier.ts", // 通知システム
];

/**
 * 推奨スクリプト一覧（あると良い）
 */
const RECOMMENDED_SCRIPTS = [
  "enforce-test-verification.ts", // テスト検証
  "verify-password-reset-tests.ts", // 自動テスト実行
];

/**
 * settings.jsonを検証
 */
function validateSettings(): ValidationResult {
  const result: ValidationResult = {
    isValid: true,
    errors: [],
    warnings: [],
    summary: {
      totalHooks: 0,
      preToolUseHooks: 0,
      postToolUseHooks: 0,
      criticalScripts: [],
    },
  };

  const settingsPath = path.join(process.cwd(), ".claude", "settings.json");

  // ファイル存在確認
  if (!fs.existsSync(settingsPath)) {
    result.errors.push("❌ .claude/settings.json が存在しません");
    result.isValid = false;
    return result;
  }

  try {
    const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));

    // hooks存在確認
    if (!settings.hooks) {
      result.errors.push("❌ hooks設定が存在しません");
      result.isValid = false;
      return result;
    }

    const hooks = settings.hooks;
    const foundScripts = new Set<string>();

    // PreToolUse検証
    if (hooks.PreToolUse) {
      hooks.PreToolUse.forEach((hookGroup: any) => {
        if (hookGroup.hooks) {
          result.summary.preToolUseHooks += hookGroup.hooks.length;
          hookGroup.hooks.forEach((hook: any) => {
            result.summary.totalHooks++;

            // コマンドからスクリプト名を抽出
            const command = hook.command || "";
            CRITICAL_SCRIPTS.forEach((script) => {
              if (command.includes(script)) {
                foundScripts.add(script);
                result.summary.criticalScripts.push(script);
              }
            });
            RECOMMENDED_SCRIPTS.forEach((script) => {
              if (command.includes(script)) {
                foundScripts.add(script);
              }
            });
          });
        }
      });
    }

    // PostToolUse検証
    if (hooks.PostToolUse) {
      hooks.PostToolUse.forEach((hookGroup: any) => {
        if (hookGroup.hooks) {
          result.summary.postToolUseHooks += hookGroup.hooks.length;
          hookGroup.hooks.forEach((hook: any) => {
            result.summary.totalHooks++;

            const command = hook.command || "";
            // スクリプト検出
            [...CRITICAL_SCRIPTS, ...RECOMMENDED_SCRIPTS].forEach((script) => {
              if (command.includes(script)) {
                foundScripts.add(script);
                if (
                  CRITICAL_SCRIPTS.includes(script) &&
                  !result.summary.criticalScripts.includes(script)
                ) {
                  result.summary.criticalScripts.push(script);
                }
              }
            });
          });
        }
      });
    }

    // UserPromptSubmit検証
    if (hooks.UserPromptSubmit) {
      hooks.UserPromptSubmit.forEach((hookGroup: any) => {
        if (hookGroup.hooks) {
          hookGroup.hooks.forEach((hook: any) => {
            result.summary.totalHooks++;

            const command = hook.command || "";
            [...CRITICAL_SCRIPTS, ...RECOMMENDED_SCRIPTS].forEach((script) => {
              if (command.includes(script)) {
                foundScripts.add(script);
                if (
                  CRITICAL_SCRIPTS.includes(script) &&
                  !result.summary.criticalScripts.includes(script)
                ) {
                  result.summary.criticalScripts.push(script);
                }
              }
            });
          });
        }
      });
    }

    // 必須スクリプトの欠落チェック
    CRITICAL_SCRIPTS.forEach((script) => {
      if (!foundScripts.has(script)) {
        result.errors.push(`❌ 必須スクリプト ${script} が設定されていません`);
        result.isValid = false;
      }
    });

    // 推奨スクリプトの欠落チェック
    RECOMMENDED_SCRIPTS.forEach((script) => {
      if (!foundScripts.has(script)) {
        result.warnings.push(
          `⚠️  推奨スクリプト ${script} が設定されていません`,
        );
      }
    });

    // 最小フック数チェック
    if (result.summary.totalHooks < 5) {
      result.errors.push(
        `❌ フック数が少なすぎます (${result.summary.totalHooks}個)。最低5個必要です`,
      );
      result.isValid = false;
    }

    // バランスチェック
    if (result.summary.preToolUseHooks === 0) {
      result.errors.push("❌ PreToolUseフックが1つも設定されていません");
      result.isValid = false;
    }
    if (result.summary.postToolUseHooks === 0) {
      result.warnings.push("⚠️  PostToolUseフックが設定されていません");
    }
  } catch (error) {
    result.errors.push(`❌ settings.json の解析エラー: ${error}`);
    result.isValid = false;
  }

  return result;
}

/**
 * 検証結果を表示
 */
function displayResult(result: ValidationResult) {
  console.log("\n🔍 Settings.json 検証結果");
  console.log("═".repeat(50));

  console.log(`\n📊 サマリー:`);
  console.log(`  総フック数: ${result.summary.totalHooks}`);
  console.log(`  PreToolUse: ${result.summary.preToolUseHooks}`);
  console.log(`  PostToolUse: ${result.summary.postToolUseHooks}`);
  console.log(
    `  必須スクリプト: ${result.summary.criticalScripts.length}/${CRITICAL_SCRIPTS.length}`,
  );

  if (result.errors.length > 0) {
    console.log("\n🚨 エラー:");
    result.errors.forEach((error) => console.log(`  ${error}`));
  }

  if (result.warnings.length > 0) {
    console.log("\n⚠️  警告:");
    result.warnings.forEach((warning) => console.log(`  ${warning}`));
  }

  console.log("\n═".repeat(50));

  if (result.isValid) {
    console.log("✅ 設定は有効です");
  } else {
    console.log("❌ 設定に問題があります。修正が必要です");
    process.exit(1);
  }
}

/**
 * メイン実行
 */
function main() {
  const result = validateSettings();
  displayResult(result);

  // バックアップ推奨
  if (result.isValid) {
    const backupPath = `.claude/settings.backup.${Date.now()}.json`;
    console.log(
      `\n💡 ヒント: 設定を変更する前にバックアップを作成してください:`,
    );
    console.log(`   cp .claude/settings.json ${backupPath}`);
  }
}

// スクリプトが直接実行された場合のみ実行
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { validateSettings, CRITICAL_SCRIPTS, RECOMMENDED_SCRIPTS };
