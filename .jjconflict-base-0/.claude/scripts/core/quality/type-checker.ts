/**
 * TypeScript型チェック実行
 *
 * @description npm run typecheckとIDE診断エラーの両方を検出する
 */

import { execSync } from "child_process";
import type { TypeCheckResult } from "../../../../src/types/hooks/edit-validation.js";

/**
 * IDE診断エラーを取得
 *
 * @returns IDE診断エラー配列
 */
async function getIdeDiagnostics(): Promise<
  Array<{ file: string; line: number; message: string }>
> {
  try {
    // Claude Code環境では mcp__ide__getDiagnostics が利用可能
    // ただし、このスクリプトからは直接呼び出せないため、
    // edit-validator.ts で直接呼び出す設計とする
    // ここでは空配列を返す（プレースホルダー）
    return [];
  } catch {
    return [];
  }
}

/**
 * TypeScript型チェック実行
 *
 * @returns 型チェック結果
 */
export async function runTypeCheck(): Promise<TypeCheckResult> {
  const result: TypeCheckResult = {
    hasErrors: false,
    errors: [],
    hasIdeDiagnostics: false,
    ideDiagnostics: [],
  };

  // 1. npm run typecheckを実行
  try {
    const output = execSync("npm run typecheck 2>&1", {
      encoding: "utf8",
      cwd: process.cwd(),
    });

    // 型エラーの検出（tryブロック - 成功時）
    const hasErrors = output.includes("error TS");

    if (hasErrors) {
      result.hasErrors = true;
      // エラー行を抽出
      const lines = output.split("\n");
      for (const line of lines) {
        if (line.includes("error TS")) {
          result.errors.push(line.trim());
        }
      }
    }
  } catch (error: any) {
    // typecheckが失敗した場合（exit code !== 0）
    // execSyncのエラーはstdout/stderrが結合されたoutputに格納される
    const output = error.output
      ? error.output.join("")
      : error.stdout || error.stderr || String(error);

    const hasErrors = output.includes("error TS");

    if (hasErrors) {
      result.hasErrors = true;
      const lines = output.split("\n");
      for (const line of lines) {
        if (line.includes("error TS")) {
          result.errors.push(line.trim());
        }
      }
    }
  }

  // 2. IDE診断エラーを取得（プレースホルダー）
  // 注: 実際の実装はedit-validator.tsで直接mcp__ide__getDiagnosticsを呼び出す
  result.ideDiagnostics = await getIdeDiagnostics();
  result.hasIdeDiagnostics = result.ideDiagnostics.length > 0;

  return result;
}
