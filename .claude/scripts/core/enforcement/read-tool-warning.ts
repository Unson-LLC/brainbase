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

  const warningMessage = `Code reading: ${relativePath} を広く読んだため、以後は brainbase-capability-map の code.reading に従い、必要なら Serena の symbol/pattern 読みへ切り替える。`;

  return {
    shouldWarn: true,
    filePath,
    relativePath,
    warningMessage,
  };
}
