---
spec_id: spec-session-list-sticky-sort
story_id: story-session-list-sticky-sort
status: accepted
---

# Spec: timeline sticky-done 並び順

## Invariants

- `orderTimelineSessions(arr, currentId, deriveUi)` は次の3段で安定ソートする:
  1. favorite(`s.favorite === true`)が上
  2. activity 優先度(sticky 適用後): 作業中(running/starting/waiting または activity thinking/working/waiting)=1、
     完了未読(done-unread)=2、それ以外=3
  3. timestamp 降順: `liveActivity.updatedAt || hookStatus.lastDoneAt || lastActivityAt || createdAt`
- sticky-done: `attentionStickyById`(module スコープ Map)に完了時刻を記憶する。
  - livePriority===1 のとき該当 id を Map から削除する。
  - livePriority===2 のとき Map[id]=完了時刻 をセットする。
  - livePriority===3 かつ Map に記憶ありのとき、実効 priority=2・実効 timestamp=記憶時刻 とする。
- 一覧(arr)に存在しない id の記憶は毎回 prune される(リーク防止)。
- ヘルパは副作用 import を持たず純粋(deriveUi 注入)。desktop / mobile 島が同一ヘルパを共有する。

## Scenarios

### S1. 基本順序
作業中 > 完了未読 > idle、同一 tier 内は timestamp 降順。favorite は最上位。

### S2. sticky-done(再シャッフル防止)
done-unread だったセッションのインジケータが既読 → idle に落ちても、完了枠(priority 2)・完了時刻のまま
留まり、idle 群より上に居続ける。最下部へジャンプしない。

### S3. sticky 解除
記憶済みセッションが作業中(priority 1)になると記憶が削除され、その後 idle に落ちたら通常通り tier3 になる。

### S4. favorite 最上位 / prune
favorite は activity 優先度に関わらず最上位。一覧から外れたセッションの完了記憶は破棄され、
再登場時に古い完了枠を持ち越さない。

## Contracts

- `SessionList.jsx`(desktop) と `SessionListMobile.jsx`(mobile) は timeline 並びに同一の
  `orderTimelineSessions` を使い、同じ sticky Map を共有する。
- project ビューは対象外(favorite-first + 保存/ドラッグ順維持の従来挙動)。

## Anti-patterns (this fix avoids)

- done-unread → 既読(idle) の瞬間に最下部へジャンプし、活動変化のたびリストが再シャッフルする
- desktop と mobile で別々の sort 実装を持ち挙動が乖離する
- sticky Map が消えたセッションの記憶を保持し続けてリークする

## Verification

- `tests/unit/session-order-sticky.test.js`(6): 基本順序 / sticky 維持 / sticky 解除 / favorite / prune / priority
- `tests/e2e/story-session-list-sticky-sort-contract.spec.ts`(4): AC1-4

## Out Of Scope

- project グループビューの並び
- 優先度tier・timestamp基準の変更
