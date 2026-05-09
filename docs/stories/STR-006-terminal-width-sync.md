---
story_id: STR-006
title: Terminal width follows visible workspace
source_requirement:
  type: user_report
  description: terminal領域の右側に余白があるのに、出力が途中で折り返される。UI幅とtmux pane幅を一致させる。
architecture_docs:
  - path: docs/brainbase-capabilities/capabilities/vibepro.impact-review.yml
    status: referenced
    reason: terminal transport はruntime/UI state-machineに跨るためGraphify impact reviewを実施。
related_tasks:
  - task_source: VibePro
    task_ids: [story-terminal-width-sync]
status: done
created_at: 2026-05-09
updated_at: 2026-05-09
---

# STR-006: Terminal width follows visible workspace

## 背景

`グローウィン` セッションでは、ブラウザ上のterminal背景は右側まで広がっているのに、出力が途中で折り返されていた。

tmux実測では `session-1776740190304` のpaneが `63x33` のままで、UI表示幅に対してtmux列幅が同期されていなかった。

## 変更内容

- xterm hostを `ResizeObserver` で監視する。
- host幅・高さが実際に変わった時に `syncViewportSize()` をdebounce実行する。
- `syncViewportSize()` は `fitAddon.fit()` 後のxterm列数をserverへ送り、tmux paneを同じサイズへresizeする。
- 左パネルの幅変更でも `resize` event を発火し、既存のwindow resize経路でも同期する。
- 右ドロワーの開閉でも `resize` event を発火し、terminal領域の拡縮を同期する。

## 受け入れ基準

- [x] window幅が変わらなくても、terminal host幅が変わればxterm fitが再実行される
- [x] xterm列数が変わったらserverへresizeが送られる
- [x] 左パネルのリサイズでもterminal幅同期が走る
- [x] 右ドロワーの開閉でもterminal幅同期が走る
- [x] `グローウィン` のtmux pane幅が63列のまま残らず、表示領域相当の列数へ更新される
- [x] 既存のscrollback保持を壊さない

## Graphify Impact Review

- command: `vibepro graph . --run-graphify`
- artifact: `.vibepro/graphify/graph.json`
- impacted paths:
  - `public/modules/core/terminal-transport-client.js`
  - `public/modules/ui/panel-resize.js`
  - `public/modules/ui/panel-layout-manager.js`
  - `server/services/terminal-transport-service.js`
  - `server/services/session-runtime/terminal-io-methods.js`

## 検証

```bash
npm test -- tests/unit/terminal-transport-client.test.js tests/ui/panel-resize.test.js tests/ui/panel-layout-manager.test.js
TARGET_URL=http://localhost:31013 node /Users/ksato/workspace/code/brainbase/.claude/skills/playwright-skill/run.js /tmp/playwright-terminal-width-sync.js
tmux list-panes -a -F '#{session_name} #{pane_width}x#{pane_height}' | grep session-1776740190304
```
