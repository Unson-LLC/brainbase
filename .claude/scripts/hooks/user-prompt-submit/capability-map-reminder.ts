#!/usr/bin/env npx tsx

// 2026-05-21: 常時注入だと「wallpaper化」して agent に無視されるため、
// プロンプトが brainbase 機能/障害切り分けキーワードを含む時だけ強リマインドを返す。
// 検出しない時は空文字を返し、agent context を汚さない。

import { logHookExecution } from "../../lib/logging/hook-logger.js";

// brainbase capability / UI / 障害キーワード
const CAPMAP_KEYWORDS_RE =
  /session作成|sessionが|sessionの作成|auth\s?grant|auth grant|31013|xterm|terminal\b|launchd|capability|runbook|brainbase|project selector|projectが見え|プロジェクトが見え|プロジェクトが表示|セッションが作れ|表示されない|認証が|JWT|localStorage|オートマージ|オートリスタート|再起動が|プロセスが|起動しない|落ちる|ttyd|enter効か|IME|描画/i;

// 動かない系を brainbase context と組み合わせた時のみ追加で発火
const FAILURE_WITH_BRAINBASE_CONTEXT_RE =
  /(brainbase|session|UI|画面|ttyd|xterm|terminal|port|localhost:31013)[^\n]{0,40}(動かない|見えない|壊れ|表示されない|消える|繋がらない|落ちる|起動しない|フリーズ)|(動かない|見えない|壊れ|表示されない|消える|繋がらない|落ちる|起動しない|フリーズ)[^\n]{0,40}(brainbase|session|UI|画面|ttyd|xterm|terminal|port|localhost:31013)/i;

function shouldEmit(prompt: string): boolean {
  if (!prompt || prompt.trim().length === 0) return false;
  return (
    CAPMAP_KEYWORDS_RE.test(prompt) ||
    FAILURE_WITH_BRAINBASE_CONTEXT_RE.test(prompt)
  );
}

function buildCapabilityMapReminder(): string {
  return [
    "[CAPMAP_TRIGGER_DETECTED] Brainbase capability キーワードを検出した。返答前に対応する capability yaml を Read せよ:",
    "- 入口: .claude/skills/brainbase-capability-map/SKILL.md の inline 表で該当 capability_id を特定。",
    "- 本体: docs/brainbase-capabilities/capabilities/<capability_id>.yml を Read で取得 (16 ファイル)。",
    "- 関連: docs/brainbase-capabilities/runbooks/*.md / troubleshooting/*.md。",
    "- 機能が動いていると主張する時は yaml の verification 節にあるコマンド/ファイル/API/ログを引用する。",
    "- SKILL.md を cat / sed するだけは『読んだ気になる』儀式で、本体 yaml 未参照は規約違反。",
  ].join(" ");
}

async function main() {
  const prompt = process.env.CLAUDE_USER_PROMPT || "";
  const emit = shouldEmit(prompt);
  try {
    logHookExecution(
      "UserPromptSubmit",
      "capability-map-reminder",
      emit ? "trigger 検出 → 強リマインド注入" : "trigger 未検出 → スキップ",
    );
    console.log(
      JSON.stringify({
        continue: true,
        systemMessage: emit ? buildCapabilityMapReminder() : "",
        suppressOutput: true,
      }),
    );
  } catch (error) {
    logHookExecution(
      "UserPromptSubmit",
      "capability-map-reminder",
      `エラー: ${error instanceof Error ? error.message : String(error)}`,
    );
    console.log(
      JSON.stringify({
        continue: true,
        systemMessage: "",
        suppressOutput: true,
      }),
    );
  }
}

void main();
