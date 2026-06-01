---
story_id: story-session-list-idle-recency-sort
title: セッションリスト timeline の idle(無印) 並びを直近活動時刻の時系列に直す
status: implemented
horizon: M1
view: runtime
period: 2026-06
reason: 島の timeline ソートで idle セッションが存在しない lastActivityAt → ISO 文字列 createdAt に落ち、文字列比較が NaN になって時系列が無視されていた局所修正。sessionSortTimestamp のフォールバックのみ変更。優先度tier・sticky-done・favorite-first は不変。public/dist は再ビルドのみ。
architecture_docs:
  - path: docs/session-activity-indicator-lifecycle.md
    status: referenced
    reason: sessionSortTimestamp のフォールバック解決のみの局所修正。EventBus/Store/DI/Service層の境界・データフロー・UI状態機械は不変。優先度tier/sticky-done/favorite-first/比較子も不変で新規アーキ判断なし
spec_docs:
  - path: docs/specs/story-session-list-idle-recency-sort-spec.md
    status: accepted
source_requirement:
  requirement_title: セッションリストの無印(idle)セッションが時系列で並ばない問題を直す
---

# セッションリスト timeline の idle(無印) 並びを直近活動時刻の時系列に直す

## Background

ユーザー報告:「まだセッションリストのソートがおかしい。無印になった場合にも時系列で上から並ぶはずだよね？今時系列が無視されるケースが多い」。

ライブデータ(ローカルサーバ `/api/state` + `/api/sessions/status` の実 43 セッション)で
現行モジュール `ui-islands/session-list/sessionOrder.js` をそのまま実行して再現・特定:

- `sessionSortTimestamp(s, ui)` のフォールバックは
  `live?.updatedAt || hookStatus?.lastDoneAt || s?.lastActivityAt || s?.createdAt || 0`。
- **`s.lastActivityAt` はセッションオブジェクトに存在しない**(サーバ schema は `createdAt` /
  `updatedAt` / 埋め込み `hookStatus` のみ)。よって idle セッションは必ず `s.createdAt` に落ちる。
- **`createdAt` は ISO 文字列**(例 `"2026-02-09T00:14:34.399Z"`)。一方ライブ ts は epoch 数値。
  比較子 `mb.timestamp - ma.timestamp` が**文字列同士で `NaN`** になり、idle 同士は実質ソートされず
  **配列の挿入順のまま**並ぶ(= 時系列無視)。
- 実証: 実モジュールで「Brainbase保守」は今この瞬間も稼働(直近活動 02:09)なのに #14。その上に
  「補助金ブリッジ融資」(最終活動 05-28、4日前)や「佐藤ブランド戦略」(05-31) が居座る。
- 本当の直近活動時刻は**埋め込み `s.hookStatus`(lastActivityAt / lastWorkingAt / lastDoneAt)と
  `s.updatedAt`** に残っているのに、ソートはこれを一切参照していなかった。

## Change

`sessionSortTimestamp` を「**必ず epoch ミリ秒の数値を返す**」+「**実際の直近活動時刻でフォールバック**」に修正:

- `toMs(value)`: ISO 文字列(createdAt / updatedAt 等)を `Date.parse` で数値化。NaN は 0。
- `embeddedRecency(s)`: セッション埋め込み `hookStatus` の `lastActivityAt` / `lastWorkingAt` /
  `lastDoneAt` の最大値。ライブ status ストアから外れた idle セッションでも直近活動時刻が残る。
- フォールバック順:
  `live.updatedAt → hookStatus.lastDoneAt → hookStatus.lastActivityAt → embeddedRecency(s) →
  s.lastActivityAt → s.updatedAt → s.createdAt`。すべて `toMs` 経由で数値。
- 優先度tier(作業中>完了>idle)・sticky-done 機構・favorite-first・比較子は**不変**(最小差分)。
- `public/dist/session-list-island.js` を再ビルド(start.js も起動時に再ビルド)。

## Acceptance Criteria

- [x] idle(無印) セッションは直近活動時刻の降順(時系列)で並ぶ
- [x] sessionSortTimestamp は ISO 文字列の createdAt を epoch ミリ秒の数値で返す
- [x] idle セッションは createdAt より埋め込み hookStatus の直近活動時刻を優先する
- [x] 既存の優先度tier(作業中>完了>idle)と sticky-done と favorite-first は不変

## Implementation Evidence

- `ui-islands/session-list/sessionOrder.js`: `sessionSortTimestamp` を toMs 正規化 + 直近活動フォールバックに修正
- `public/dist/session-list-island.js`: 再ビルド
- `tests/unit/session-order-sticky.test.js`: idle recency ブロック追加(計10)
- `tests/e2e/story-session-list-idle-recency-sort-contract.spec.ts`(4): AC 契約

## Out Of Scope

- 優先度tier・sticky-done・favorite-first・比較子の変更(不変)
- project(グループ)ビューの並び(favorite-first + ドラッグ/保存順維持、従来通り)
- セッション schema への `lastActivityAt` 追加(サーバ側変更はしない)
