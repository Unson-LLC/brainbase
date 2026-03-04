#!/usr/bin/env node
/**
 * Serena MCP使用強制フック（実装）
 *
 * TypeScript/JavaScriptファイルに対するReadツール使用を検出し、
 * Serena MCPツールの使用を強制する。
 *
 * 実行タイミング: PreToolUse (Read)
 */

import * as path from "path";
import { fileURLToPath } from "url";
import type {
  ToolUseInput,
  EnforcementResult,
} from "../../../../src/types/hooks/serena-enforcement.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// プロジェクトルートを取得（.claude/scripts/hooks/pre-tool-use からルートへ）
const PROJECT_ROOT = path.resolve(__dirname, "../../../../");

/**
 * Serena MCP強制処理
 * @param input - ツール実行情報
 * @returns 強制結果
 */
export function enforceSerenaMcp(input: ToolUseInput): EnforcementResult {
  // TypeScript/JavaScriptファイルの拡張子
  const CODE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx"];

  if (input.tool === "Read") {
    const filePath = input.parameters.file_path as string;

    // コードファイルかチェック
    const isCodeFile = CODE_EXTENSIONS.some((ext) => filePath.endsWith(ext));

    if (isCodeFile) {
      // 絶対パスを相対パスに変換
      const relativePath = path.isAbsolute(filePath)
        ? path.relative(PROJECT_ROOT, filePath)
        : filePath;

      const result: EnforcementResult = {
        permissionDecision: "deny",
        blocked: true,
        reason: "Readツールでコードファイルを読もうとしています",
        filePath,
        relativePath,
        suggestedTools: [
          {
            name: "mcp__serena__get_symbols_overview",
            purpose: "ファイル概要の取得",
            example: {
              relative_path: relativePath,
            },
          },
          {
            name: "mcp__serena__search_for_pattern",
            purpose: "パターン検索",
            example: {
              substring_pattern: "検索したいパターン",
              relative_path: relativePath,
              context_lines_before: 5,
              context_lines_after: 5,
            },
          },
          {
            name: "mcp__serena__find_symbol",
            purpose: "シンボル詳細読み込み（必要な場合のみ）",
            example: {
              name_path: "シンボル名",
              relative_path: relativePath,
              include_body: true,
            },
          },
        ],
        reference:
          "@CLAUDE.md セクション11: 超重要事項：コード読み込み時のSerena MCP使用必須",
      };

      return result;
    }
  }

  // 許可
  return {
    permissionDecision: "allow",
    blocked: false,
  };
}

// このファイルはコアロジックのみを提供
// エントリーポイントは serena-enforcement-wrapper.ts
