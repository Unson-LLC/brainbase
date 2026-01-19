#!/usr/bin/env npx tsx
/**
 * 自動コンテキスト読み込みフック
 *
 * @description セッション開始時にCLAUDE.mdで参照されているファイルを自動読み込み
 * @author SalesTailor Development Team
 * @version 1.0.0
 */

import * as fs from "fs";
import * as path from "path";
import type { ContextFile } from "../../../../src/types/hooks/auto-context-loader.js";
import { logHookExecution } from "../logging/hook-logger.js";

/**
 * CLAUDE.mdから参照ファイルを抽出
 *
 * @description CLAUDE.md内の`- ラベル: `ファイルパス``形式の行を解析し、
 *              実際のファイル（ドキュメント）のみを抽出する
 * @returns {ContextFile[]} 抽出されたファイル情報の配列
 * @example
 * // CLAUDE.md内の行例:
 * // - **技術スタック**: `docs/tech_stack.md`
 * // - タスクの進め方: `docs/rules/development/task_approach.md`
 */
function extractReferencedFiles(): ContextFile[] {
  try {
    const claudeMdPath = path.join(process.cwd(), "CLAUDE.md");

    if (!fs.existsSync(claudeMdPath)) {
      return [];
    }

    const content = fs.readFileSync(claudeMdPath, "utf-8");
    const lines = content.split("\n");
    const referencedFiles: ContextFile[] = [];

    // パターン1: - **ラベル**: `ファイルパス`
    // パターン2: - ラベル: `ファイルパス`
    const referencePattern = /^-\s+(.+?):\s*`([^`]+)`/;

    // パターン3: 文章中の `ファイルパス` (拡張子付きファイルのみ)
    const inlineFilePattern = /`([^`]+\.[a-zA-Z]{2,4})`/g;

    for (const line of lines) {
      // パターン1,2: CLAUDE.mdのリスト形式
      const listMatch = line.match(referencePattern);
      if (listMatch) {
        let label = listMatch[1].trim();
        let filePath = listMatch[2].trim();

        // **で囲まれたラベルから**を除去
        label = label.replace(/^\*\*(.*)\*\*$/, "$1");

        // 実際のファイルパス（拡張子のあるもの）のみ抽出（コードファイルは除外）
        const docExtensions = [
          ".md",
          ".json",
          ".prisma",
          ".sql",
          ".yaml",
          ".yml",
        ];
        const isDocumentFile =
          docExtensions.some((ext) => filePath.endsWith(ext)) ||
          (filePath.startsWith("docs/") &&
            !filePath.includes(".ts") &&
            !filePath.includes(".tsx")) ||
          (filePath.startsWith("@docs/") &&
            !filePath.includes(".ts") &&
            !filePath.includes(".tsx")) ||
          filePath.startsWith("prisma/");

        // TypeScript/JavaScriptファイルを除外（コードは読み込み対象外）
        const isCodeFile =
          filePath.endsWith(".ts") ||
          filePath.endsWith(".tsx") ||
          filePath.endsWith(".js") ||
          filePath.endsWith(".jsx");

        if (!isDocumentFile || isCodeFile) {
          continue; // エージェント名、コマンド名、コードファイルをスキップ
        }

        // @docs/プレフィックスを除去
        if (filePath.startsWith("@docs/")) {
          filePath = filePath.replace("@docs/", "docs/");
        }

        const fullPath = path.join(process.cwd(), filePath);
        const exists = fs.existsSync(fullPath);

        // ディレクトリの場合はスキップ
        if (exists && fs.statSync(fullPath).isDirectory()) {
          continue;
        }

        referencedFiles.push({
          label,
          filePath,
          exists,
          content: exists ? fs.readFileSync(fullPath, "utf-8") : undefined,
        });
        continue;
      }

      // パターン3: 文章中の拡張子付きファイル参照（行の先頭に-がなくても対象）
      const inlineMatches = [...line.matchAll(inlineFilePattern)];
      for (const inlineMatch of inlineMatches) {
        let filePath = inlineMatch[1].trim();

        // デバッグ: 検出されたファイルパスをログ出力
        if (filePath.includes("design_principles")) {
          console.error(`[DEBUG] Found design_principles: ${filePath}`);
        }

        // 実際のファイルパス（拡張子のあるもの）のみ抽出（コードファイルは除外）
        const docExtensions = [
          ".md",
          ".json",
          ".prisma",
          ".sql",
          ".yaml",
          ".yml",
        ];
        const isDocumentFile =
          docExtensions.some((ext) => filePath.endsWith(ext)) ||
          (filePath.startsWith("docs/") &&
            !filePath.includes(".ts") &&
            !filePath.includes(".tsx")) ||
          (filePath.startsWith("@docs/") &&
            !filePath.includes(".ts") &&
            !filePath.includes(".tsx")) ||
          filePath.startsWith("prisma/");

        // TypeScript/JavaScriptファイルを除外（コードは読み込み対象外）
        const isCodeFile =
          filePath.endsWith(".ts") ||
          filePath.endsWith(".tsx") ||
          filePath.endsWith(".js") ||
          filePath.endsWith(".jsx");

        if (!isDocumentFile || isCodeFile) {
          continue; // エージェント名、コマンド名、コードファイルをスキップ
        }

        // @docs/プレフィックスを除去
        if (filePath.startsWith("@docs/")) {
          filePath = filePath.replace("@docs/", "docs/");
        }

        const fullPath = path.join(process.cwd(), filePath);
        const exists = fs.existsSync(fullPath);

        // ディレクトリの場合はスキップ
        if (exists && fs.statSync(fullPath).isDirectory()) {
          continue;
        }

        // 重複チェック（既に追加済みでないか確認）
        const alreadyAdded = referencedFiles.some(
          (file) => file.filePath === filePath,
        );
        if (alreadyAdded) {
          continue;
        }

        const label = `文書内参照: ${path.basename(filePath)}`;
        referencedFiles.push({
          label,
          filePath,
          exists,
          content: exists ? fs.readFileSync(fullPath, "utf-8") : undefined,
        });
      }
    }

    // 第2段階: 読み込まれたファイルの内容からも文書内参照を抽出
    const firstRoundFiles = [...referencedFiles];
    for (const file of firstRoundFiles) {
      if (file.exists && file.content) {
        const fileLines = file.content.split("\n");
        for (const line of fileLines) {
          const inlineMatches = [...line.matchAll(inlineFilePattern)];
          for (const inlineMatch of inlineMatches) {
            let filePath = inlineMatch[1].trim();

            // 実際のファイルパス（拡張子のあるもの）のみ抽出（コードファイルは除外）
            const docExtensions = [
              ".md",
              ".json",
              ".prisma",
              ".sql",
              ".yaml",
              ".yml",
            ];
            const isDocumentFile =
              docExtensions.some((ext) => filePath.endsWith(ext)) ||
              (filePath.startsWith("docs/") &&
                !filePath.includes(".ts") &&
                !filePath.includes(".tsx")) ||
              (filePath.startsWith("@docs/") &&
                !filePath.includes(".ts") &&
                !filePath.includes(".tsx")) ||
              filePath.startsWith("prisma/");

            // TypeScript/JavaScriptファイルを除外（コードは読み込み対象外）
            const isCodeFile =
              filePath.endsWith(".ts") ||
              filePath.endsWith(".tsx") ||
              filePath.endsWith(".js") ||
              filePath.endsWith(".jsx");

            if (!isDocumentFile || isCodeFile) {
              continue; // エージェント名、コマンド名、コードファイルをスキップ
            }

            // @docs/プレフィックスを除去
            if (filePath.startsWith("@docs/")) {
              filePath = filePath.replace("@docs/", "docs/");
            }

            const fullPath = path.join(process.cwd(), filePath);
            const exists = fs.existsSync(fullPath);

            // ディレクトリの場合はスキップ
            if (exists && fs.statSync(fullPath).isDirectory()) {
              continue;
            }

            // 重複チェック（既に追加済みでないか確認）
            const alreadyAdded = referencedFiles.some(
              (refFile) => refFile.filePath === filePath,
            );
            if (alreadyAdded) {
              continue;
            }

            const label = `文書内参照: ${path.basename(filePath)} (from ${path.basename(file.filePath)})`;
            referencedFiles.push({
              label,
              filePath,
              exists,
              content: exists ? fs.readFileSync(fullPath, "utf-8") : undefined,
            });
          }
        }
      }
    }

    return referencedFiles;
  } catch (error) {
    return [];
  }
}

/**
 * コンテキストファイルの要約生成
 *
 * @description ファイル内容を指定した最大長で要約し、重要な情報を優先的に抽出
 * @param {string} content 要約対象のファイル内容
 * @param {number} maxLength 要約の最大文字数（デフォルト: 1000）
 * @returns {string} 要約されたコンテンツ
 * @note 見出し（#）、リスト項目（-、*）、コードブロック（```）、
 *       太字（**）を優先的に抽出し、重要な情報を保持
 */
function summarizeFile(content: string, maxLength: number = 1000): string {
  if (content.length <= maxLength) {
    return content;
  }

  // 重要な部分を抽出（見出し、リスト項目、コードブロック）
  const lines = content.split("\n");
  const importantLines: string[] = [];
  let currentLength = 0;

  for (const line of lines) {
    const trimmedLine = line.trim();

    // 見出し、リスト項目、コードブロックは優先的に含める
    if (
      trimmedLine.startsWith("#") ||
      trimmedLine.startsWith("-") ||
      trimmedLine.startsWith("*") ||
      trimmedLine.startsWith("```") ||
      trimmedLine.includes("**")
    ) {
      if (currentLength + line.length > maxLength) {
        break;
      }

      importantLines.push(line);
      currentLength += line.length + 1;
    }
  }

  return importantLines.join("\n") + "\n\n... (要約されました)";
}

/**
 * コンテキスト読み込みメイン処理
 *
 * @description CLAUDE.mdから抽出したファイルを読み込み、Claude CLIに結果を返す
 * @returns {Promise<any>} Claude Code Hook仕様に準拠したJSONレスポンス
 * @note レスポンス形式: { continue: boolean, systemMessage: string, suppressOutput: boolean }
 * @throws {Error} ファイル読み込みまたは処理中のエラー
 */
async function loadAutoContext(): Promise<any> {
  try {
    const referencedFiles = extractReferencedFiles();

    if (referencedFiles.length === 0) {
      const response = {
        continue: true,
        systemMessage: "📋 CLAUDE.md: 参照ファイルが見つかりませんでした",
        suppressOutput: false,
      };
      console.log(JSON.stringify(response));
      return response;
    }

    const existingFiles = referencedFiles.filter((file) => file.exists);
    const missingFiles = referencedFiles.filter((file) => !file.exists);

    let contextMessage = "📋 **自動コンテキスト読み込み完了**\\n\\n";

    // 読み込まれたファイルの一覧
    if (existingFiles.length > 0) {
      contextMessage += "**📖 読み込まれたドキュメント:**\\n";
      for (const file of existingFiles) {
        const summary = summarizeFile(file.content!, 500);
        contextMessage += `\\n**${file.label}** (${file.filePath}):\\n`;
        contextMessage += `\`\`\`\\n${summary}\\n\`\`\`\\n`;
      }
    }

    // 見つからなかったファイル
    if (missingFiles.length > 0) {
      contextMessage += "\\n**⚠️ 見つからなかったファイル:**\\n";
      for (const file of missingFiles) {
        contextMessage += `• ${file.label}: ${file.filePath}\\n`;
      }
    }

    contextMessage += `\\n**📊 コンテキスト統計:**\\n`;
    contextMessage += `• 読み込み成功: ${existingFiles.length}ファイル\\n`;
    contextMessage += `• 読み込み失敗: ${missingFiles.length}ファイル\\n`;
    contextMessage += `• 合計参照: ${referencedFiles.length}ファイル`;

    const response = {
      continue: true,
      systemMessage: contextMessage,
      suppressOutput: false,
    };

    console.log(JSON.stringify(response));
    return response;
  } catch (error) {
    const errorResponse = {
      continue: true,
      systemMessage: `⚠️ 自動コンテキスト読み込みエラー: ${String(error)}`,
      suppressOutput: false,
    };

    console.log(JSON.stringify(errorResponse));
    return errorResponse;
  }
}

/**
 * セッション状態チェック（初回実行判定）
 *
 * @description セッション状態ファイルを確認し、初回実行または1時間経過時にtrueを返す
 * @returns {boolean} 初回実行または再実行が必要な場合にtrue
 * @note セッション状態は.claude/session-state.jsonに保存
 * @note 1時間以内の重複実行を防止してパフォーマンスを最適化
 */
function isFirstSession(): boolean {
  const stateFile = path.join(
    process.cwd(),
    ".claude",
    "hooks",
    "data",
    "auto-context-loader",
    "session-state.json",
  );

  if (!fs.existsSync(stateFile)) {
    // 初回実行
    const stateData = {
      lastContextLoad: new Date().toISOString(),
      sessionCount: 1,
    };

    // データディレクトリが存在しない場合は作成
    const dataDir = path.dirname(stateFile);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    fs.writeFileSync(stateFile, JSON.stringify(stateData, null, 2));
    return true;
  }

  try {
    const stateData = JSON.parse(fs.readFileSync(stateFile, "utf-8"));
    const lastLoad = new Date(stateData.lastContextLoad);
    const now = new Date();

    // 1時間以上経過していれば再読み込み
    const hoursSinceLastLoad =
      (now.getTime() - lastLoad.getTime()) / (1000 * 60 * 60);

    if (hoursSinceLastLoad > 1) {
      stateData.lastContextLoad = now.toISOString();
      stateData.sessionCount = (stateData.sessionCount || 1) + 1;
      fs.writeFileSync(stateFile, JSON.stringify(stateData, null, 2));
      return true;
    }

    return false;
  } catch (error) {
    return true; // エラー時は再読み込み
  }
}

/**
 * メイン実行関数
 *
 * @description セッション状態を確認し、必要に応じてコンテキスト読み込みを実行
 * @returns {Promise<any>} Claude Code Hook仕様準拠のJSONレスポンス
 * @note 初回またはタイムアウト時のみloadAutoContext()を実行
 * @note 最近実行済みの場合はスキップメッセージを返す
 */
async function main(): Promise<any> {
  // 初回セッションまたは時間経過時のみ実行
  if (isFirstSession()) {
    logHookExecution("UserPromptSubmit", "context-loader", "初回実行または1時間経過 - コンテキスト読み込み実行");
    return await loadAutoContext();
  } else {
    logHookExecution("UserPromptSubmit", "context-loader", "最近実行済み - スキップ");
    const response = {
      continue: true,
      systemMessage: "📋 コンテキスト: 最近読み込み済み（スキップ）",
      suppressOutput: true,
    };
    console.log(JSON.stringify(response));
    return response;
  }
}

// 実行
import { fileURLToPath } from "url";
const __filename = fileURLToPath(import.meta.url);
const isMainModule = process.argv[1] === __filename;

if (isMainModule) {
  main();
}

export { loadAutoContext };
