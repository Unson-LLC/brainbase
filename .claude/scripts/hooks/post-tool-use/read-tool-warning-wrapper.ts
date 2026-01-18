#!/usr/bin/env npx tsx

/**
 * Readツール使用警告フック（薄いラッパー）
 *
 * @description PostToolUse(Read)でSerena MCP使用を強制する警告を表示
 */

import { checkReadToolUsage } from "../../core/enforcement/read-tool-warning.js";
import { logHookExecution } from "../../lib/logging/hook-logger.js";

async function main() {
  const rawInput = process.argv[2] || "{}";

  // 環境変数からも情報を取得（Claude Code公式）
  const eventType = process.env.CLAUDE_EVENT_TYPE || "unknown";
  const toolName = process.env.CLAUDE_TOOL_NAME || "unknown";
  const filePaths = process.env.CLAUDE_FILE_PATHS || "";

  logHookExecution(
    "PostToolUse",
    "READ-WARNING-RAW",
    `Raw input: ${rawInput.slice(0, 200)}`,
  );
  logHookExecution(
    "PostToolUse",
    "READ-WARNING-ENV",
    `Env - EventType: ${eventType}, ToolName: ${toolName}, FilePaths: ${filePaths}`,
  );

  let toolInput: any;
  try {
    toolInput = JSON.parse(rawInput);
  } catch (error) {
    logHookExecution(
      "PostToolUse",
      "READ-WARNING-PARSE-ERROR",
      `JSON parse failed: ${String(error)}, falling back to env vars`,
    );

    // $CLAUDE_TOOL_INPUTが空でも、環境変数から情報を取得
    if (toolName === "Read" && filePaths) {
      toolInput = {
        tool: "Read",
        parameters: {
          file_path: filePaths.split(" ")[0], // 最初のファイルパスを使用
        },
      };
      logHookExecution(
        "PostToolUse",
        "READ-WARNING-ENV-RECOVERY",
        `Recovered from env vars - File: ${toolInput.parameters.file_path}`,
      );
    } else {
      // 環境変数からも取得できない場合は警告なし
      const hookResponse = {
        continue: true,
        systemMessage: "",
        suppressOutput: false,
      };
      console.log(JSON.stringify(hookResponse));
      process.exit(0);
      return;
    }
  }

  logHookExecution(
    "PostToolUse",
    "READ-WARNING-START",
    `検証開始 - Tool: ${toolInput.tool}, File: ${toolInput.parameters?.file_path || "N/A"}`,
  );

  const result = checkReadToolUsage(toolInput);

  logHookExecution(
    "PostToolUse",
    "READ-WARNING-RESULT",
    `結果 - ShouldWarn: ${result.shouldWarn}, File: ${result.relativePath || "N/A"}`,
  );

  // 警告が必要な場合
  if (result.shouldWarn) {
    logHookExecution(
      "PostToolUse",
      "READ-WARNING-VIOLATION",
      `違反検出 - File: ${result.relativePath}`,
    );

    const hookResponse = {
      continue: true, // 処理は継続（Fail-Safe原則）
      systemMessage: result.warningMessage,
      suppressOutput: false,
    };

    console.log(JSON.stringify(hookResponse));
    process.exit(0);
  } else {
    // 警告不要（非コードファイル）
    logHookExecution(
      "PostToolUse",
      "READ-WARNING-OK",
      `問題なし - File: ${toolInput.parameters?.file_path || "N/A"}`,
    );

    const hookResponse = {
      continue: true,
      systemMessage: "",
      suppressOutput: false,
    };

    console.log(JSON.stringify(hookResponse));
    process.exit(0);
  }
}

// Hook entry point
if (process.argv[1] === import.meta.url.replace("file://", "")) {
  main().catch((error) => {
    console.error("❌ Readツール警告実行エラー:", error);
    process.exit(1);
  });
}
