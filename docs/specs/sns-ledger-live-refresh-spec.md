---
spec_id: SPEC-sns-ledger-live-refresh
title: SNS Ledger Live Refresh
status: implemented
date: 2026-05-16
story_id: str.brainbase.sns-ledger-live-refresh
implementation_files:
  - public/modules/ui/views/sns-growth-cockpit-view.js
test_files:
  - tests/ui/views/sns-growth-cockpit-view.test.js
  - tests/e2e/sns-growth-cockpit.spec.js
---

# SPEC: SNS Ledger Live Refresh

## Purpose

`/ohayo` がPosting LedgerへSNS投稿候補を取り込んだ後、SNS Growth画面をハードリフレッシュせずに最新のLedger状態を表示する。

## Invariants

- **INV-1**: 自動更新は既存の `listPosts({ startDate, endDate })` API clientだけを使う。
- **INV-2**: 自動更新は `review-pack` import、投稿公開、scheduler、X APIを呼ばない。
- **INV-3**: interval、window focus、document visibilitychange のいずれかでLedger再取得を開始できる。
- **INV-4**: `data-detail-field` にfocusがある間は、自動更新をスキップする。
- **INV-5**: unmount時にinterval、focus listener、visibilitychange listenerを解除する。
- **INV-6**: 手動 reload action は従来通りloading stateとerror表示を使う。

## Contract

```ts
new SnsGrowthCockpitView({
  apiClient,
  autoRefreshIntervalMs?: number
})
```

- `autoRefreshIntervalMs > 0` のとき、mount後に自動更新を開始する。
- test runtimeの既定値は `0` とし、テストが明示した場合だけintervalを有効化する。
- browser runtimeの既定値は `15000` ms とする。

## Scenarios

### S-1: Ohayo import after page open appears without hard refresh

- given: SNS Growth画面が開いている
- when: 別プロセスが `POST /api/sns-growth/review-pack` で投稿候補を投入する
- then: focus復帰または次回intervalで `GET /api/sns-growth/posts` が走る
- and: 新しい投稿候補がカレンダーに表示される

### S-2: Editing is not clobbered by auto refresh

- given: 詳細ペインの本文textareaにfocusがある
- when: intervalまたはfocus eventが起きる
- then: 自動更新はスキップされる
- and: 入力中の本文は保持される

## Verification

| Clause | Test |
|---|---|
| INV-1, INV-3, S-1 | `tests/ui/views/sns-growth-cockpit-view.test.js` |
| INV-4, S-2 | `tests/ui/views/sns-growth-cockpit-view.test.js` |
| S-1 runtime | `tests/e2e/sns-growth-cockpit.spec.js` |
