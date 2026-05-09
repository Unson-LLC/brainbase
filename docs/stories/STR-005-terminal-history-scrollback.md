---
story_id: STR-005
title: Terminal session history remains scrollable across live sessions
source_requirement:
  type: user_report
  description: セッションごとにスクロール可否と過去へ戻れる量が大きく異なる。tmux履歴があるセッションではUIでも履歴を読めるべき。
architecture_docs:
  - path: N/A
    status: not_required
    reason: 既存terminal transportのsnapshot種別を分ける局所変更。新規依存・新規外部APIなし。
related_tasks:
  - task_source: VibePro
    task_ids: [story-terminal-history-scrollback]
status: done
created_at: 2026-05-09
updated_at: 2026-05-09
---

# STR-005: Terminal session history remains scrollable across live sessions

## 背景

`グローウィン` セッションでは tmux の `history_size` が 4580 行あるにもかかわらず、UI の xterm は `baseY=2` でほぼスクロールできなかった。

原因は、live owner セッションでも `snapshot-polling` が `visibleOnly` の現在画面だけを初回表示に使っており、xterm scrollback に tmux履歴が積まれないこと。

## 変更内容

- セッション接続直後の eager snapshot は履歴付き snapshot を送る。
- steady-state polling は引き続き可視paneだけを送る。
- 可視pane更新は xterm の scrollback を消さない。
- 履歴ロード用 snapshot は tmux `history-limit` と揃う 5000 行まで取得できるようにする。

## 受け入れ基準

- [x] live owner セッションの接続直後に `visibleOnly: false` の履歴付き snapshot が送られる
- [x] steady-state `snapshot-polling` は `visibleOnly: true` の可視pane更新を維持する
- [x] client は履歴付き snapshot で scrollback を初期化し、以後の `screenOnly` snapshot で scrollback を消さない
- [x] snapshot API/cache は履歴ロード用途で最大5000行を扱える
- [x] `グローウィン` のように tmux履歴があるセッションで、Playwright上の xterm `baseY` が現在画面数行ではなく履歴分に増える

## 検証

```bash
vibepro graph . --run-graphify
npm test -- tests/server/services/terminal-transport-service.test.js tests/unit/terminal-transport-client.test.js
TARGET_URL=http://localhost:31013 node run.js /tmp/playwright-growin-scroll.js
```
