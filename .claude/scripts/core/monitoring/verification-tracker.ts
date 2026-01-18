#!/usr/bin/env npx tsx

/**
 * 検証アクション自動追跡システム
 *
 * すべてのツール使用を監視し、技術実装に必要な事実確認アクションを自動記録
 * PostToolUse hookとして動作し、実行済みの検証証拠を蓄積
 */

import * as fs from "fs";
import * as path from "path";

import type { VerificationRecord } from "../../../../src/types/claude-hooks.js";

const VERIFICATION_LOG_PATH = ".claude/verification-evidence.json";

function loadVerificationHistory(): VerificationRecord[] {
  try {
    if (fs.existsSync(VERIFICATION_LOG_PATH)) {
      const data = fs.readFileSync(VERIFICATION_LOG_PATH, "utf-8");
      return JSON.parse(data);
    }
  } catch (error) {
    console.warn("⚠️ 検証履歴の読み込みに失敗");
  }
  return [];
}

function logVerificationAction(
  action: string,
  result: string,
  toolUsed: string,
  inputSummary: string = "",
) {
  const record: VerificationRecord = {
    timestamp: new Date().toISOString(),
    action,
    result,
    toolUsed,
    inputSummary: inputSummary.substring(0, 200), // 最初の200文字のみ保存
  };

  const history = loadVerificationHistory();
  history.push(record);

  // 過去24時間の記録のみ保持
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const filteredHistory = history.filter((record) => record.timestamp > cutoff);

  fs.mkdirSync(path.dirname(VERIFICATION_LOG_PATH), { recursive: true });
  fs.writeFileSync(
    VERIFICATION_LOG_PATH,
    JSON.stringify(filteredHistory, null, 2),
  );

  console.log(`📝 検証アクション記録: ${action} (${toolUsed})`);
}

function main() {
  const input = process.env.CLAUDE_TOOL_INPUT || "";
  const toolName = process.env.CLAUDE_TOOL_NAME || "";

  // Serenaツールの検証記録
  if (toolName.startsWith("mcp__serena__")) {
    if (
      toolName.includes("find_symbol") ||
      toolName.includes("get_symbols_overview")
    ) {
      // 型定義関連のクエリかチェック
      if (
        input.includes("interface") ||
        input.includes("type") ||
        input.includes("Interface") ||
        input.includes("Type")
      ) {
        logVerificationAction(
          "typeCheck",
          `型定義検索・読み取り実行: ${toolName}`,
          toolName,
          input,
        );
      } else {
        logVerificationAction(
          "codeRead",
          `シンボル検索・読み取り実行: ${toolName}`,
          toolName,
          input,
        );
      }
    } else if (toolName.includes("search_for_pattern")) {
      logVerificationAction(
        "codeRead",
        `パターン検索実行: ${toolName}`,
        toolName,
        input,
      );
    } else if (toolName.includes("read_file")) {
      logVerificationAction(
        "codeRead",
        `ファイル読み取り実行: ${toolName}`,
        toolName,
        input,
      );
    }
  }

  // Bashツールの検証記録
  if (toolName === "Bash") {
    if (input.includes("curl")) {
      logVerificationAction("apiCall", "API呼び出し実行", "Bash", input);
    } else if (
      input.includes("test") ||
      input.includes("vitest") ||
      input.includes("jest")
    ) {
      logVerificationAction("testExecution", "テスト実行", "Bash", input);
    } else if (input.includes("grep") || input.includes("find")) {
      logVerificationAction("codeSearch", "コード検索実行", "Bash", input);
    } else if (
      input.includes("cat") ||
      input.includes("head") ||
      input.includes("tail")
    ) {
      logVerificationAction("fileRead", "ファイル確認実行", "Bash", input);
    }
  }

  // Readツールの検証記録
  if (toolName === "Read") {
    logVerificationAction("fileRead", "ファイル読み取り実行", "Read", input);
  }

  // WebFetchツールの検証記録
  if (toolName === "WebFetch") {
    logVerificationAction(
      "documentationRead",
      "外部文書参照実行",
      "WebFetch",
      input,
    );
  }

  console.log("✅ 検証追跡完了");
}

// ESM compatible execution check
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
