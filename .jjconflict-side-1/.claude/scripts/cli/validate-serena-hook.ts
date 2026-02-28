#!/usr/bin/env node
/**
 * Serena MCP強制フックの検証スクリプト
 *
 * settings.jsonにSerena MCP強制フックが正しく登録されているか検証する
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SETTINGS_PATH = path.join(__dirname, "../../settings.json");
const HOOK_PATH = path.join(
  __dirname,
  "../../hooks/pre-tool-use-serena-enforcement.ts",
);

console.log("🔍 Serena MCP強制フック検証開始...\n");

// 1. settings.json存在確認
if (!fs.existsSync(SETTINGS_PATH)) {
  console.error("❌ settings.jsonが見つかりません");
  process.exit(1);
}

// 2. フックスクリプト存在確認
if (!fs.existsSync(HOOK_PATH)) {
  console.error("❌ pre-tool-use-serena-enforcement.tsが見つかりません");
  process.exit(1);
}

// 3. フックスクリプトの実行権限確認
const stats = fs.statSync(HOOK_PATH);
const isExecutable = !!(stats.mode & fs.constants.S_IXUSR);
if (!isExecutable) {
  console.error("❌ pre-tool-use-serena-enforcement.tsに実行権限がありません");
  console.error(
    "   修正コマンド: chmod +x .claude/hooks/pre-tool-use-serena-enforcement.ts",
  );
  process.exit(1);
}

// 4. settings.json内容確認
const settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf-8"));

const preToolUseHooks = settings.hooks?.PreToolUse || [];
const readHook = preToolUseHooks.find((h: any) => h.matcher === "Read");

if (!readHook) {
  console.error("❌ settings.jsonにReadツール用フックが登録されていません");
  process.exit(1);
}

const serenaEnforcementHook = readHook.hooks?.find((h: any) =>
  h.command?.includes("pre-tool-use-serena-enforcement.ts"),
);

if (!serenaEnforcementHook) {
  console.error(
    "❌ Readツールフック内にSerena強制スクリプトが登録されていません",
  );
  process.exit(1);
}

console.log("✅ Serena MCP強制フックが正しく設定されています\n");
console.log("【設定内容】");
console.log(`- フックファイル: ${HOOK_PATH}`);
console.log(`- 実行権限: あり`);
console.log(`- settings.json登録: あり`);
console.log(`- matcher: Read`);
console.log(`- timeout: ${serenaEnforcementHook.timeout || "デフォルト"}ms\n`);

console.log("【動作】");
console.log("TypeScript/JavaScriptファイルに対するReadツール使用時、");
console.log("Serena MCPツールの使用を強制的に促します。\n");

console.log("【テスト方法】");
console.log("以下のコマンドで動作テストが可能です：");
console.log(
  'npx tsx .claude/hooks/pre-tool-use-serena-enforcement.ts \'{"tool":"Read","parameters":{"file_path":"/path/to/file.ts"}}\'',
);

process.exit(0);
