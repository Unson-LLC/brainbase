---
story_id: story-session-list-sticky-sort
title: セッションリスト timeline の sticky-done 並び順を島レンダラに復元する
status: implemented
horizon: M1
view: runtime
period: 2026-05
reason: 島の timeline ソートに、vanilla にあった sticky-done 機構を共有純粋ヘルパとして復元する局所修正。優先度tierとtimestamp基準は不変、favorite-first も不変。public/dist は再ビルドのみ。
architecture_docs:
  - path: docs/session-activity-indicator-lifecycle.md
    status: accepted
spec_docs:
  - path: docs/specs/story-session-list-sticky-sort-spec.md
    status: accepted
source_requirement:
  requirement_title: セッションリストのソート順が以前と違って再シャッフルする問題を直す
---

# セッションリスト timeline の sticky-done 並び順を復元

## Background

ユーザー報告:「セッションリストのソート順が以前と違って狂った」。

調査(git 履歴比較)で特定:

- 現行の島(`ui-islands/session-list/SessionList.jsx` / `SessionListMobile.jsx`)の timeline ソートは
  favorite → activity優先度(running/waiting=1, done-unread=2, idle=3) → timestamp降順。優先度は
  **毎レンダーで現在状態から再計算**(記憶なし)。
- 旧 vanilla `_getTimelineSessions` には `_timelineAttentionSortBySessionId` という **sticky-done 機構**が
  あり(コメント原文「緑インジケータが既読で消えても、その場で通常枠へ落とさない」)、PR #895 の島移行で
  **脱落**していた。
- ロジック差: 旧は done-unread(2) を記憶し、その後インジケータ既読で idle(3) に落ちても priority 2・
  完了時刻で固定して完了枠に留め、作業中(1)になったら記憶解除。島はこれが無く、
  **done-unread → 既読(idle) の瞬間に tier3 へ落ちて最下部へジャンプ**し、活動変化のたびリストが
  再シャッフルする(= 「狂った」と感じる挙動)。
- 加えて hook 群修正(#888-#912)で多くのセッションが正しく working/done を報告するようになり、
  優先度ソートが以前より活発に効いて再シャッフルが目立っていた。

## Change

sticky-done 機構を **共有純粋ヘルパ `ui-islands/session-list/sessionOrder.js`** として復元:

- module スコープの `attentionStickyById` Map に「完了時刻」を記憶(desktop/mobile 共有、再レンダー跨ぎ保持)。
- `orderTimelineSessions(arr, currentId, deriveUi)`: livePriority 1→記憶解除, 2→記憶, 3かつ記憶あり→
  実効 priority 2・記憶時刻 で完了枠に留める。一覧から消えた id は prune(リーク防止)。
- favorite-first / 優先度tier / timestamp基準(updatedAt→lastDoneAt→lastActivityAt→createdAt)は不変。
- `SessionList.jsx` / `SessionListMobile.jsx` は重複していた sort を本ヘルパに置換。
- `deriveUi` を注入式にしたのでヘルパは `/modules/` import を持たず vitest から直接テスト可能。
- `public/dist/session-list-island.js` を再ビルド(start.js も起動時に再ビルド)。

## Acceptance Criteria

- [x] timeline は favorite → 作業中>完了>idle → 時刻降順 でソートする
- [x] done-unread セッションは既読(idle)後も完了枠(sticky)に留まり最下部へ落ちない
- [x] 作業中になったら sticky 完了記憶は解除される
- [x] favorite は activity 優先度より常に上 / 一覧から消えたセッションの sticky はリークしない

## Implementation Evidence

- `ui-islands/session-list/sessionOrder.js`: sticky-done 機構(新規・純粋・DI)
- `ui-islands/session-list/SessionList.jsx` / `SessionListMobile.jsx`: 共有ヘルパへ置換
- `public/dist/session-list-island.js`: 再ビルド
- `tests/unit/session-order-sticky.test.js`(6) / `tests/e2e/story-session-list-sticky-sort-contract.spec.ts`(4)

## Out Of Scope

- project(グループ)ビューの並び(favorite-first + ドラッグ/保存順維持、従来通り)
- 優先度tier・timestamp基準の変更(不変)
- vanilla session-view の復活(島が唯一の描画器のまま)
