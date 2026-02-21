#!/usr/bin/env npx tsx
/**
 * 環境構成セクション自動挿入フック
 *
 * @description worktreeセッション開始時に環境構成情報を自動挿入
 * @author brainbase Development Team
 * @version 1.0.0
 */

import * as fs from "fs";
import * as path from "path";
import { logHookExecution } from "../logging/hook-logger.js";

/**
 * Worktreeセッション判定
 *
 * @description 現在のディレクトリがworktreeかどうかを判定し、環境情報を取得
 * @returns {Object} worktree判定結果と環境パス情報
 * @example
 * // worktree内: /Users/ksato/workspace/brainbase-config/.worktrees/session-1771656200964
 * // → { isWorktree: true, worktreePath: "...", serverPath: "/Users/ksato/workspace/code/brainbase" }
 */
function isWorktreeSession(): { isWorktree: boolean; worktreePath: string; serverPath: string } {
  const cwd = process.cwd();

  // `.worktrees/session-*`パターン
  const worktreePattern = /\.worktrees\/session-\d+/;
  const isWorktree = worktreePattern.test(cwd);

  const worktreePath = cwd;
  const serverPath = "/Users/ksato/workspace/code/brainbase";

  return { isWorktree, worktreePath, serverPath };
}

/**
 * 環境情報セクション生成
 *
 * @description worktree環境の詳細情報をMarkdown形式で生成
 * @param {string} worktreePath worktreeの絶対パス
 * @param {string} serverPath サーバーコードの絶対パス
 * @returns {string} Markdown形式の環境構成セクション
 * @note Event/Frame/Story構造に対応し、AIが「今どこにいるか」を理解できるようにする
 */
function generateEnvironmentSection(worktreePath: string, serverPath: string): string {
  const sessionId = path.basename(worktreePath);

  return `## 環境構成（このworktreeのフレーム）

### 現在の位置
- Worktreeパス: ${worktreePath}
- 親リポジトリ: /Users/ksato/workspace/code/brainbase
- サーバーパス: ${serverPath}

### 3層リポジトリ構造
\`\`\`
brainbase (Public) ← upstream
brainbase-unson (Private) ← 日常開発
brainbase-config (Private) ← 個人設定
\`\`\`

### jj workspace構造
- \`default@\` (サーバー)
- \`${sessionId}@\` (このworktree)

### 編集場所と反映先
| 対象 | 編集場所 | 反映先 |
|------|---------|--------|
| サーバー動作 | ${serverPath} | launchd起動中 |
| worktree開発 | ${worktreePath} | jj → PR → マージ後 |
| tmux設定 | ~/.tmux.conf | 全セッション共通 |

**重要**: サーバー動作に関わる設定（tmux statusline等）は \`${serverPath}\` で編集すること。
`;
}

/**
 * 環境セクション挿入メイン処理
 *
 * @description worktree環境の場合のみ環境セクションを生成し、systemMessageで挿入
 * @returns {Promise<any>} Claude Code Hook仕様に準拠したJSONレスポンス
 * @note レスポンス形式: { continue: boolean, systemMessage: string, suppressOutput: boolean }
 * @throws {Error} 環境情報取得またはセクション生成中のエラー
 */
async function injectEnvironmentSection(): Promise<any> {
  try {
    const { isWorktree, worktreePath, serverPath } = isWorktreeSession();

    if (!isWorktree) {
      // worktree外の場合はスキップ
      const response = {
        continue: true,
        systemMessage: "📋 環境セクション: worktree外のため挿入不要",
        suppressOutput: true,
      };
      console.log(JSON.stringify(response));
      return response;
    }

    // 環境セクション生成
    const envSection = generateEnvironmentSection(worktreePath, serverPath);

    // systemMessageで挿入（CLAUDE.mdファイルは編集しない）
    const contextMessage = `📋 **環境構成セクション自動挿入**\\n\\n${envSection}`;

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
      systemMessage: `⚠️ 環境セクション挿入エラー: ${String(error)}`,
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
 * @note セッション状態は.claude/hooks/data/env-section-injector/session-state.jsonに保存
 * @note 1時間以内の重複実行を防止してパフォーマンスを最適化
 */
function isFirstSession(): boolean {
  const stateFile = path.join(
    process.cwd(),
    ".claude",
    "hooks",
    "data",
    "env-section-injector",
    "session-state.json",
  );

  if (!fs.existsSync(stateFile)) {
    // 初回実行
    const stateData = {
      lastInjection: new Date().toISOString(),
      injectionCount: 1,
    };

    const dataDir = path.dirname(stateFile);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    fs.writeFileSync(stateFile, JSON.stringify(stateData, null, 2));
    return true;
  }

  try {
    const stateData = JSON.parse(fs.readFileSync(stateFile, "utf-8"));
    const lastInjection = new Date(stateData.lastInjection);
    const now = new Date();

    // 1時間以上経過していれば再挿入
    const hoursSinceLastInjection =
      (now.getTime() - lastInjection.getTime()) / (1000 * 60 * 60);

    if (hoursSinceLastInjection > 1) {
      stateData.lastInjection = now.toISOString();
      stateData.injectionCount = (stateData.injectionCount || 1) + 1;
      fs.writeFileSync(stateFile, JSON.stringify(stateData, null, 2));
      return true;
    }

    return false;
  } catch (error) {
    return true; // エラー時は再挿入
  }
}

/**
 * メイン実行関数
 *
 * @description セッション状態を確認し、必要に応じて環境セクション挿入を実行
 * @returns {Promise<any>} Claude Code Hook仕様準拠のJSONレスポンス
 * @note 初回またはタイムアウト時のみinjectEnvironmentSection()を実行
 * @note 最近実行済みの場合はスキップメッセージを返す
 */
async function main(): Promise<any> {
  // 初回セッションまたは時間経過時のみ実行
  if (isFirstSession()) {
    logHookExecution("UserPromptSubmit", "env-section-injector", "初回実行または1時間経過 - 環境セクション挿入実行");
    return await injectEnvironmentSection();
  } else {
    logHookExecution("UserPromptSubmit", "env-section-injector", "最近実行済み - スキップ");
    const response = {
      continue: true,
      systemMessage: "📋 環境セクション: 最近挿入済み（スキップ）",
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

export { injectEnvironmentSection };
