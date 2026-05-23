---
story_id: story-session-switch-performance
title: Improve Brainbase session switch xterm readiness
source_requirement:
  type: user_report
  description: Brainbase のセッション切り替えで、スナップショットが見えるだけではなく xterm が表示され入力可能になるまでの体感時間を短くしたい。
architecture_docs:
  - path: docs/architecture/terminal-runtime-architecture.md
    status: referenced
related_tasks:
  - task_source: VibePro
    task_ids: [story-session-switch-performance]
status: active
created_at: 2026-05-16
updated_at: 2026-05-16
---

# story-session-switch-performance: Improve Brainbase session switch xterm readiness

## 背景

Brainbase のセッション切り替えでは、ユーザーが次のセッションを選んだあと、スナップショットが先に見えても xterm がまだ表示されず、文字入力できない時間が残ることがある。

ユーザーが求めている切り替え完了は「スナップショットが出た時点」ではなく、「対象セッションの xterm が表示され、WebSocket 入力経路が使える状態になった時点」である。

## 現状

- セッション切り替え中に `/context` 更新、session data load、snapshot prefetch が競合し、xterm 表示より前の処理を増やすことがある。
- すでに `interactive_ready` かつ input ready な active session でも、`terminal/ensure` や input probe が余分に走ることがある。
- input probe の snapshot 取得が詰まると、E2E canary が `PROBE_TIMEOUT` ではなくテストタイムアウトまで待つことがある。
- VibePro の PR gate では、この story が明示されていないため Requirement Gate が `needs_review` になっていた。

## 変更内容

### 誰が

- Brainbase のブラウザ UI で複数セッションを切り替えながら Claude Code / Codex を操作するユーザー

### 何を

- セッション切り替えの完了条件を、対象セッションの xterm が表示され入力可能になることとして扱う。
- 切り替え中は非 terminal 系の refresh、context 取得、snapshot prefetch を xterm 表示完了後に遅らせる。
- すでに `interactive_ready` で input ready な active session では、runtime 再起動や余分な input probe を避ける。
- input probe が snapshot 取得で詰まった場合は、5秒以内に `PROBE_TIMEOUT` として失敗を返し、E2E が長時間固まらないようにする。
- 切り替え後の xterm に対して、Playwright canary で marker を WebSocket input path から送信できることを確認する。

### なぜ

- ユーザーがセッション切り替え直後にすぐ入力できる体感を得るため。
- スナップショットだけを成功扱いにすると、実際の xterm 操作可能時間を改善できたか判断できないため。
- 余分な probe や prefetch を避けることで、切り替え経路の待ち時間と失敗要因を減らすため。

## 受け入れ基準

- [ ] セッション切り替え時間は、セッション選択または `switchSession` 開始から、対象セッションの xterm が表示され `inputReady=true` になるまでで評価される。
- [ ] 切り替え中の SessionContextBar は `_pendingTerminalSwitch` が完了するまで `/context` refresh を延期する。
- [ ] 切り替え中の snapshot prefetch は、xterm 表示完了後まで延期される。
- [ ] `terminal/ensure` は active session が `interactive_ready` かつ input ready で、viewer が block されていない場合に fast-path を返す。
- [ ] `TerminalTransportClient.verifyInputReady()` は、すでに owner で WebSocket 接続済みかつ `inputReady=true` の場合、probe API を呼ばず成功扱いにする。
- [ ] input probe の snapshot 取得は 5秒以内に成功または `PROBE_TIMEOUT` で完了する。
- [ ] archived session はこの story で自動復旧・自動 active 化しない。
- [ ] E2E canary は、切り替え後の xterm から marker を WebSocket input path で送信できることを検証する。
- [ ] `state.currentSessionId` と `this._isXtermTransportActive(sessionId` は、現在対象セッションの判定と active xterm の再接続回避条件として扱う。
- [ ] `switchToken !== this._sessionSwitchToken` と `sessionId && pending.toSessionId && pending.toSessionId !== sessionId` は、古い切り替え処理を捨てる条件として扱う。
- [ ] `!this.terminalTransportClient || !session?.id` と `!session?.id` と `typeof controller.terminalIo?.repairCollapsedSessionWindow !== 'function'` は、xterm transport、session id、geometry repair がない場合の safe no-op 条件として扱う。
- [ ] `!session || session.intendedState === 'archived'` と `session.intendedState === 'archived'` と `session.intendedState !== 'active'` と `!updatedSession.intendedState` と `Object.prototype.hasOwnProperty.call(updatedSession, 'archived'` は、session intent と legacy migration の互換条件として扱う。
- [ ] `this._isXtermTransportActive(sessionId` は、すでに対象 session の xterm transport が active な場合に再接続しない条件として扱う。
- [ ] `typeof controller.terminalIo?.repairCollapsedSessionWindow !== 'function'` は、geometry repair が未提供の環境でも terminal ensure を失敗させない optional guard として扱う。
- [ ] `session.intendedState !== 'active'` は、terminal ensure 成功後に non-active session だけを active intent へ更新する条件として扱う。
- [ ] `!updatedSession.intendedState` と `Object.prototype.hasOwnProperty.call(updatedSession, 'archived'` は、legacy session state の互換 migration 条件として扱い、この performance story では挙動を変更しない。

## スコープ外

- ttyd fallback 自体の UX 改善。
- terminal scrollback の仕様変更。
- session state migration の仕様変更。
- archived session の restore UX。
- business KPI としての厳密な p95/p99 SLA の確定。

## 逆質問

- セッション切り替えの目標値を数値 SLA として置く場合、ローカル開発環境での p95 を何 ms 以下にしますか。現時点では「xterm 表示かつ inputReady までを測る」ことを受け入れ基準にし、具体的な p95 閾値は未確定にしています。

## 検証

```bash
npm run test:run -- tests/ui/session-context-bar-view.test.js tests/unit/server-session-controller.test.js tests/server/services/terminal-transport-service.test.js tests/unit/terminal-transport-client.test.js tests/server/services/terminal-input-probe-service.test.js
npx eslint public/modules/core/terminal-transport-client.js server/services/terminal-input-probe-service.js public/modules/ui/views/session-context-bar-view.js public/modules/app/terminal-input-ux-mixin.js server/controllers/session/runtime-handlers.js server/services/terminal-transport-service.js
PORT=31077 BRAINBASE_PORT=31077 BRAINBASE_BASE_URL=http://127.0.0.1:31077 npm run test:e2e -- tests/e2e/story-terminal-input-render-stability-canary.spec.ts
```
