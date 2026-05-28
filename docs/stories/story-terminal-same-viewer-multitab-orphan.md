---
story_id: terminal-same-viewer-multitab-orphan
title: 同一viewerIdのマルチタブでterminal接続をorphan化させずsupersedeする
source_requirement:
  type: user_report
  description: >-
    viewerId をタブ単位(sessionStorage)から端末単位(localStorage)へ変更した(PR #881)後、
    同一ブラウザの複数タブが同じ viewerId を共有するようになった。その結果、同一viewerの
    2つ目のタブを開くと1つ目のタブの terminal WebSocket が activeConnections から外れたまま
    閉じられず orphan 化し、blocked 通知も出ないまま stale 化してタブを閉じるまで残る。
architecture_docs:
  - path: docs/brainbase-capabilities/capabilities/terminal.transport.yml
    status: referenced
    reason: >-
      terminal WebSocket の所有権・supersede ポリシーは既存の terminal transport capability の
      範囲内。EventBus/Store/DI/Service層・WSプロトコル契約・ownershipモデルに新規構造変更はなく、
      single-active-connection 不変条件を同一viewerにも適用する局所修正のため ADR は不要。
related_tasks:
  - task_source: VibePro
    task_ids: [terminal-same-viewer-multitab-orphan]
status: active
created_at: 2026-05-28
updated_at: 2026-05-28
---

# 同一viewerIdのマルチタブでterminal接続をorphan化させずsupersedeする

## Background

brainbase の terminal は viewerId 単位で WebSocket 接続と tmux 所有権(ownership)を管理する。
`server/services/terminal-transport-service.js` は1セッションにつき1つのアクティブ接続
(`activeConnections`)だけを保持し、別 viewer が接続してきたときは graceful-supersede として
旧接続に `blocked`(reason: session_taken_over) を送って close(4001)していた。

PR #881 で viewerId が sessionStorage(タブ単位)から localStorage(端末単位)へ変更され、同一
ブラウザの複数タブが同じ viewerId を共有するようになった。supersede 条件が
`existing.viewerId !== viewerId` の時だけ発火していたため、同一viewerの2つ目のタブを開くと
supersede がスキップされ、`activeConnections` が新接続で上書きされて1つ目のタブの WebSocket が
map から外れたまま閉じられず orphan 化する。orphan は stale 化し、`blocked` 通知も出ないため
ユーザーはタブを閉じるまで気づけない。

correctness の破壊ではない(旧接続の close ハンドラは `current.ws === ws` ガードで ownership の
誤解放を防いでいる)が、localStorage 化により発生しやすくなった未カバーのマルチタブエッジである。

## Scope

- 「1セッション = アクティブ接続1つ」の不変条件を同一viewerにも適用する。
- 別viewer の takeover は従来どおり `blocked` + close 4001(session_taken_over)を維持する。
- 同一viewer の2つ目のタブ接続時は、旧タブを orphan にせず明示的にクローズする。
- 旧接続を `activeConnections` から削除してから close することで、旧接続の close ハンドラが
  新接続の ownership を誤解放しないようにする。
- クライアントは同一viewer supersede の close code を再接続を誘発しない形で扱い、別viewer奪取の
  blocked UI とも区別する。
- 同一viewer同時接続パスのユニット/統合テストと real-browser E2E を追加する。

## Acceptance Criteria

- [x] 同一viewerIdの2つ目のタブ接続時、旧タブの WebSocket は orphan 化せず明示的に close される。
- [x] 同一viewer の supersede は close code 4002 と `superseded`(reason: session_superseded_same_viewer) 通知で行い、別viewer奪取の blocked とは区別する。
- [x] 別viewer の takeover は従来どおり `blocked` + close 4001(session_taken_over) を維持する。
- [x] クライアントは 4002 を EXPECTED close として扱い、再接続(タブ間ピンポン)せず、mode を blocked にもしない。
- [x] 旧接続の close ハンドラは新接続の ownership を誤解放しない(map削除順序と current.ws===ws ガード)。
- [x] 同一viewer同時接続パスのユニット/統合テストと real-browser E2E を追加する。

## Out Of Scope

- viewerId の生成・保存方式(localStorage 化そのもの, PR #881)の変更。
- tmux 所有権 TTL やowner判定ロジックの変更。
- 複数タブを同時アクティブにする(マルチアクティブ接続)機能の追加。
- `superseded` メッセージを使ったクライアント側 UI バナーの追加(現状は close code 4002 が挙動を駆動)。

## Verification

```bash
vibepro story diagnose . --id terminal-same-viewer-multitab-orphan --run-graphify
npm run test:run -- tests/server/services/terminal-transport-service.test.js tests/unit/terminal-transport-client.test.js tests/unit/terminal-transport-reconnect.test.js
BRAINBASE_E2E_PORT=31055 npm run test:e2e -- tests/e2e/story-terminal-same-viewer-multitab-supersede.spec.ts --project=chromium
```

Regression coverage は (1) 同一viewerの2タブ目で旧タブが superseded/4002 で閉じ orphan が残らないこと、
(2) 別viewer takeover の 4001/blocked が維持されること、(3) 4002 が EXPECTED 扱いで再接続しない一方
異常切断(1006)は再接続すること、を pre-fix 実装で落ちる形で含む。
