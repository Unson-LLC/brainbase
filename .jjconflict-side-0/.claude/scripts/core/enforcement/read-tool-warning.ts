#!/usr/bin/env node
/**
 * Readツール使用警告（PostToolUse）
 *
 * @description コードファイルに対するReadツール使用を検出し、
 *              Serena MCP使用を強く推奨する警告を表示
 *
 * @author SalesTailor Development Team
 */

import * as path from "path";

/**
 * Readツール使用警告の結果
 */
export interface ReadToolWarningResult {
  shouldWarn: boolean;
  filePath?: string;
  relativePath?: string;
  warningMessage?: string;
}

/**
 * Readツール使用を検証し、コードファイルの場合は警告
 *
 * @param toolInput - ツール実行情報
 * @returns 警告結果
 */
export function checkReadToolUsage(toolInput: any): ReadToolWarningResult {
  // TypeScript/JavaScriptファイルの拡張子
  const CODE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx"];

  if (!toolInput || !toolInput.parameters?.file_path) {
    return { shouldWarn: false };
  }

  const filePath = toolInput.parameters.file_path as string;

  // コードファイルかチェック
  const isCodeFile = CODE_EXTENSIONS.some((ext) => filePath.endsWith(ext));

  if (!isCodeFile) {
    return { shouldWarn: false };
  }

  // 絶対パスを相対パスに変換
  const relativePath = path.isAbsolute(filePath)
    ? path.relative(process.cwd(), filePath)
    : filePath;

  const warningMessage = `
🚨 **Readツール使用違反を検出しました**

**違反内容**:
コードファイル「${relativePath}」に対してReadツールが使用されました。

**なぜ問題なのか**:
- Readツールはファイル全体を読み込むため、トークン消費が大きい
- Serena MCPは必要な部分のみを読み込むため、効率的
- CLAUDE.mdで「絶対厳守」と指定されているルール違反

**今すぐ実行すべきこと**:
1. 以下のSerena MCPツールを使用してください：

   📋 **ファイル概要の取得**:
   \`\`\`
   mcp__serena__get_symbols_overview
   {
     "relative_path": "${relativePath}"
   }
   \`\`\`

   🔍 **特定シンボルの詳細読み込み**:
   \`\`\`
   mcp__serena__find_symbol
   {
     "name_path": "シンボル名",
     "relative_path": "${relativePath}",
     "include_body": true
   }
   \`\`\`

   🔎 **パターン検索**:
   \`\`\`
   mcp__serena__search_for_pattern
   {
     "substring_pattern": "検索パターン",
     "relative_path": "${relativePath}",
     "context_lines_before": 5,
     "context_lines_after": 5
   }
   \`\`\`

**参照**: @CLAUDE.md セクション11: 超重要事項：コード読み込み時のSerena MCP使用必須

⚠️ **次回からは必ずSerena MCPツールを使用してください**
`;

  return {
    shouldWarn: true,
    filePath,
    relativePath,
    warningMessage,
  };
}
