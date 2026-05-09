#!/usr/bin/env npx tsx

import { logHookExecution } from "../../lib/logging/hook-logger.js";

function buildCapabilityMapReminder() {
  return [
    "Brainbase capability map: Brainbaseの機能、UI/API/コード/データ責務、プロジェクト/セッション作成、auth grant、31013 runtime、xterm/terminal transport、表示されない/動かない問題、検証、復旧に触れる依頼では、まず brainbase-capability-map を入口にする。",
    "docs/brainbase-capabilities/README.md を読み、次に docs/brainbase-capabilities/capabilities/ 配下の最小の関連ファイルを確認する。",
    "機能が動いていると主張するときは、確認に使ったファイル/API/プロセス/ログを明示する。",
  ].join(" ");
}

async function main() {
  try {
    logHookExecution(
      "UserPromptSubmit",
      "capability-map-reminder",
      "Brainbase capability map 参照リマインドを注入",
    );
    console.log(JSON.stringify({
      continue: true,
      systemMessage: buildCapabilityMapReminder(),
      suppressOutput: true,
    }));
  } catch (error) {
    logHookExecution(
      "UserPromptSubmit",
      "capability-map-reminder",
      `エラー: ${error instanceof Error ? error.message : String(error)}`,
    );
    console.log(JSON.stringify({
      continue: true,
      systemMessage: "",
      suppressOutput: true,
    }));
  }
}

void main();
