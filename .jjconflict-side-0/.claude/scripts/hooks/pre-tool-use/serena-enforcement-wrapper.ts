#!/usr/bin/env npx tsx

/**
 * Serena MCP使用強制フック（薄いラッパー）
 *
 * core/enforcement/serena-mcp-enforcer.tsのエントリーポイント
 */

import { enforceSerenaMcp } from "../../core/enforcement/serena-mcp-enforcer.js";
import type {
  ToolUseInput,
  HookResponse,
} from "../../../../src/types/hooks/serena-enforcement.js";
import { logHookExecution } from "../../lib/logging/hook-logger.js";

async function main() {
  const rawInput = process.argv[2] || "{}";

  // 環境変数からも情報を取得（Claude Code公式）
  const eventType = process.env.CLAUDE_EVENT_TYPE || "unknown";
  const toolName = process.env.CLAUDE_TOOL_NAME || "unknown";
  const filePaths = process.env.CLAUDE_FILE_PATHS || "";

  logHookExecution(
    "PreToolUse",
    "SERENA-ENFORCEMENT-RAW",
    `Raw input: ${rawInput.slice(0, 200)}`,
  );
  logHookExecution(
    "PreToolUse",
    "SERENA-ENFORCEMENT-ENV",
    `Env - EventType: ${eventType}, ToolName: ${toolName}, FilePaths: ${filePaths}`,
  );

  let input: ToolUseInput;
  try {
    input = JSON.parse(rawInput);
  } catch (error) {
    logHookExecution(
      "PreToolUse",
      "SERENA-ENFORCEMENT-PARSE-ERROR",
      `JSON parse failed: ${String(error)}, falling back to env vars`,
    );

    // $CLAUDE_TOOL_INPUTが空でも、環境変数から情報を取得
    if (toolName === "Read" && filePaths) {
      input = {
        tool: "Read",
        parameters: {
          file_path: filePaths.split(" ")[0], // 最初のファイルパスを使用
        },
      };
      logHookExecution(
        "PreToolUse",
        "SERENA-ENFORCEMENT-ENV-RECOVERY",
        `Recovered from env vars - File: ${input.parameters.file_path}`,
      );
    } else {
      // 環境変数からも取得できない場合は許可（Claude Code公式形式）
      const hookResponse: HookResponse = {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "allow",
          permissionDecisionReason: "入力パースエラー - デフォルトで許可",
        },
      };
      console.log(JSON.stringify(hookResponse, null, 2));
      process.exit(0);
      return;
    }
  }

  logHookExecution(
    "PreToolUse",
    "SERENA-ENFORCEMENT-START",
    `検証開始 - Tool: ${input.tool}, File: ${input.parameters?.file_path || "N/A"}`,
  );

  const result = enforceSerenaMcp(input);

  logHookExecution(
    "PreToolUse",
    "SERENA-ENFORCEMENT-RESULT",
    `結果 - Blocked: ${result.blocked}, Decision: ${result.permissionDecision}`,
  );

  // Claude Code公式形式で応答
  const hookResponse: HookResponse = {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: result.permissionDecision,
      permissionDecisionReason: result.blocked
        ? `${result.reason}\n\n推奨ツール:\n${result.suggestedTools?.map((t) => `• ${t.name}: ${t.purpose}`).join("\n")}\n\n参照: ${result.reference}`
        : "許可",
    },
  };

  console.log(JSON.stringify(hookResponse, null, 2));

  // ブロックされた場合はエラー終了
  if (result.blocked) {
    console.error(`\n❌ [SERENA-ENFORCEMENT] ${result.reason}`);
    logHookExecution(
      "PreToolUse",
      "SERENA-ENFORCEMENT-BLOCKED",
      `ブロック実行 - File: ${result.filePath}`,
    );
    process.exit(1);
  }

  logHookExecution(
    "PreToolUse",
    "SERENA-ENFORCEMENT-ALLOWED",
    `許可 - File: ${input.parameters?.file_path || "N/A"}`,
  );
  process.exit(0);
}

// Hook entry point
if (process.argv[1] === import.meta.url.replace("file://", "")) {
  main().catch((error) => {
    console.error("❌ Serena MCP強制実行エラー:", error);
    process.exit(1);
  });
}
