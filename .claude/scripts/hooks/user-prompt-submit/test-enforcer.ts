#!/usr/bin/env npx tsx

/**
 * テスト検証強制実行フック（薄いラッパー）
 *
 * core/testing/test-enforcement-manager.tsのエントリーポイント
 */

import * as path from "path";
import { fileURLToPath } from "url";
import { TestEnforcementManager } from "../../core/testing/test-enforcement-manager";
import { logHookExecution } from "../../lib/logging/hook-logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "../../..");

// ユーザープロンプトを取得
const userPrompt = process.env.CLAUDE_USER_PROMPT || "";

// ログ出力
logHookExecution("UserPromptSubmit", "test-enforcer", `プロンプト: ${userPrompt.substring(0, 50)}...`);

// テスト強制実行
const manager = new TestEnforcementManager(projectRoot);
manager.enforce(userPrompt).catch((error) => {
  logHookExecution("UserPromptSubmit", "test-enforcer", `エラー: ${error.message}`);
  console.error(error.message);
  process.exit(1);
});
