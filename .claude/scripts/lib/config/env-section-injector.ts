#!/usr/bin/env npx tsx
/**
 * 環境構成セクション自動挿入フック
 *
 * @description worktreeセッション開始時に環境構成情報を自動挿入
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { logHookExecution } from "../logging/hook-logger.js";

function isWorktreeSession(): { isWorktree: boolean; worktreePath: string; serverPath: string } {
  const cwd = process.cwd();
  const worktreePattern = /(?:\.worktrees|brainbase-worktrees)\/session-\d+/;
  const isWorktree = worktreePattern.test(cwd);

  return {
    isWorktree,
    worktreePath: cwd,
    serverPath: "/Users/ksato/workspace/code/brainbase",
  };
}

function generateEnvironmentSection(worktreePath: string, serverPath: string): string {
  const sessionId = path.basename(worktreePath);

  return `## 環境構成（このworktreeのフレーム）

### 現在の位置
- Worktreeパス: ${worktreePath}
- 親リポジトリ: /Users/ksato/workspace/code/brainbase
- サーバーパス: ${serverPath}

### jj workspace構造
- \`default@\` (サーバー)
- \`${sessionId}@\` (このworktree)

### 編集場所と反映先
| 対象 | 編集場所 | 反映先 |
|------|---------|--------|
| サーバー動作 | ${serverPath} | launchd / 手動起動中 |
| worktree開発 | ${worktreePath} | jj → PR → マージ後 |

**重要**: サーバー挙動に関わる変更は、どの checkout が実行中か確認してから触ること。`;
}

function getStateFile(): string {
  return path.join(
    process.cwd(),
    ".claude",
    "scripts",
    "hooks",
    "data",
    "env-section-injector",
    "session-state.json",
  );
}

function shouldInject(): boolean {
  const stateFile = getStateFile();

  if (!fs.existsSync(stateFile)) {
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    fs.writeFileSync(stateFile, JSON.stringify({
      lastInjection: new Date().toISOString(),
      injectionCount: 1,
    }, null, 2));
    return true;
  }

  try {
    const state = JSON.parse(fs.readFileSync(stateFile, "utf-8"));
    const lastInjection = new Date(state.lastInjection);
    const hoursSinceLastInjection = (Date.now() - lastInjection.getTime()) / (1000 * 60 * 60);
    if (hoursSinceLastInjection > 1) {
      fs.writeFileSync(stateFile, JSON.stringify({
        lastInjection: new Date().toISOString(),
        injectionCount: Number(state.injectionCount || 0) + 1,
      }, null, 2));
      return true;
    }
    return false;
  } catch {
    return true;
  }
}

async function injectEnvironmentSection(): Promise<void> {
  const { isWorktree, worktreePath, serverPath } = isWorktreeSession();

  if (!isWorktree) {
    console.log(JSON.stringify({
      continue: true,
      systemMessage: "📋 環境セクション: worktree外のため挿入不要",
      suppressOutput: true,
    }));
    return;
  }

  console.log(JSON.stringify({
    continue: true,
    systemMessage: `📋 **環境構成セクション自動挿入**\n\n${generateEnvironmentSection(worktreePath, serverPath)}`,
    suppressOutput: false,
  }));
}

async function main(): Promise<void> {
  if (!shouldInject()) {
    logHookExecution("UserPromptSubmit", "env-section-injector", "最近実行済み - スキップ");
    console.log(JSON.stringify({
      continue: true,
      systemMessage: "📋 環境セクション: 最近挿入済み（スキップ）",
      suppressOutput: true,
    }));
    return;
  }

  logHookExecution("UserPromptSubmit", "env-section-injector", "初回実行または1時間経過 - 環境セクション挿入実行");
  await injectEnvironmentSection();
}

const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] === __filename) {
  void main();
}

export { injectEnvironmentSection };
