---
spec_id: spec-session-list-idle-recency-sort
story_id: story-session-list-idle-recency-sort
status: accepted
---

# Spec: timeline idle(無印) 直近活動時刻ソート

## Invariants

- `sessionSortTimestamp(s, ui)` は**常に有限の epoch ミリ秒(数値)**を返す。文字列は返さない。
  - `toMs(value)`: 数値はそのまま(非有限は 0)、文字列は `Date.parse`(NaN は 0)、null/undefined は 0。
  - `embeddedRecency(s)`: `s.hookStatus` の `lastActivityAt` / `lastWorkingAt` / `lastDoneAt` を
    `toMs` した最大値(`s.hookStatus` が無ければ 0)。
  - フォールバック順:
    `toMs(live.updatedAt) || toMs(hookStatus.lastDoneAt) || toMs(hookStatus.lastActivityAt)
     || embeddedRecency(s) || toMs(s.lastActivityAt) || toMs(s.updatedAt) || toMs(s.createdAt) || 0`。
- `orderTimelineSessions` の3段ソート(favorite → 優先度tier(sticky適用後) → timestamp 降順)・
  sticky-done 機構・favorite-first・比較子は**不変**。本 spec は timestamp 解決のみを規定する。

## Scenarios

### S1. idle 同士は直近活動時刻の降順
ライブ status を持たない idle セッションでも、`createdAt` が ISO 文字列のまま比較されて NaN になり
挿入順固定になることはなく、直近活動時刻の降順(時系列)で並ぶ。

### S2. ISO 文字列の数値化
`createdAt` / `updatedAt` が ISO 文字列でも `sessionSortTimestamp` は `Date.parse` 相当の数値を返す。

### S3. createdAt より埋め込み hookStatus 優先
作成が古くても直近まで稼働していた idle セッションは、作成が新しいが活動が古い idle セッションより上に来る
(`embeddedRecency(s)` が `s.createdAt` より優先される)。

### S4. tier / sticky / favorite 不変
作業中 > 完了未読 > idle の優先度tier、sticky-done、favorite-first は本修正で変化しない。

## Contracts

- `SessionList.jsx`(desktop) と `SessionListMobile.jsx`(mobile) は同一 `orderTimelineSessions` /
  `sessionSortTimestamp` を共有する。
- サーバ側 session schema は変更しない(`lastActivityAt` フィールドは追加しない)。

## Anti-patterns (this fix avoids)

- idle セッションが存在しない `s.lastActivityAt` → ISO 文字列 `s.createdAt` に落ちる
- 文字列同士の数値比較が NaN になり idle 群が配列挿入順のまま固定される
- 埋め込み `s.hookStatus` / `s.updatedAt` の直近活動時刻を無視して作成時刻で並べる

## Verification

- `tests/unit/session-order-sticky.test.js`: idle recency ブロック(数値化 / 文字列 createdAt 時系列 /
  embedded 優先 / updatedAt 優先)+ 既存 sticky 6 で計10
- `tests/e2e/story-session-list-idle-recency-sort-contract.spec.ts`(4): AC1-4

## Out Of Scope

- 優先度tier・sticky-done・favorite-first・比較子の変更
- project グループビューの並び
- サーバ session schema への lastActivityAt 追加
