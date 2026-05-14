---
spec_id: SPEC-sns-posting-cockpit-feedback-to-learning
title: SNS Posting Cockpit Feedback To Learning
status: active
date: 2026-05-14
story_id: story-sns-posting-cockpit
related_adrs:
  - ADR-011
related_specs:
  - SPEC-sns-feedback-loop
implementation_files:
  - server/routes/sns-growth.js
  - public/modules/ui/views/sns-growth-cockpit-view.js
  - public/style.css
test_files:
  - tests/server/routes/sns-growth.test.js
  - tests/ui/views/sns-growth-cockpit-view.test.js
---

# SPEC: SNS Posting Cockpit Feedback To Learning

## Invariants

- **INV-1**: 投稿後 metrics は SNS Posting Ledger の `metrics_snapshots` に append され、Graph SSOT へ直書きされない。
- **INV-2**: `posted` record を `learning_ready` に進めるには metrics evidence が必要。
- **INV-3**: `deleted` record には学習準備アクションを表示しない。
- **INV-4**: UI は latest metrics を表示し、投稿本文・投稿URL・削除履歴と同じ detail panel でレビューできる。

## Contracts

### Contract-1: Feedback API

- **endpoint**: `POST /api/sns-growth/posts/:id/feedback`
- **input**:

```ts
{
  metrics_snapshot?: {
    impressions?: number;
    likes?: number;
    reposts?: number;
    replies?: number;
    bookmarks?: number;
    profile_visits?: number;
  };
  mark_learning_ready?: boolean;
}
```

- **output**: `{ post }`
- **preconditions**:
  - `:id` は SNS Posting Ledger record として存在する。
  - metrics values は 0 以上の数値。
  - `mark_learning_ready=true` の場合、今回または既存の metrics evidence が必要。
- **postconditions**:
  - metrics が渡された場合、`metrics_snapshots` に新規 snapshot を append する。
  - `posted` record に `mark_learning_ready=true` が渡された場合、status を `learning_ready` にする。
- **error cases**:
  - record が存在しない場合は 404。
  - metrics も learning 指示もない場合は 400 `sns_feedback_required`。
  - metrics evidence なしに learning_ready へ進める場合は 400 `sns_feedback_metrics_required`。

## Scenarios

### S-1: posted record に metrics を記録して learning_ready にする

- **given**: status=`posted` の SNS Ledger record がある。
- **when**: UI から impressions / likes / reposts / replies / bookmarks を入力し、学習準備にする。
- **then**: API は metrics snapshot を append し、record status を `learning_ready` にする。
- **検証**: `tests/server/routes/sns-growth.test.js`, `tests/ui/views/sns-growth-cockpit-view.test.js`

### S-2: metrics evidence なしの learning_ready を拒否する

- **given**: metrics snapshot がない status=`posted` の SNS Ledger record がある。
- **when**: `mark_learning_ready=true` だけを送る。
- **then**: API は 400 `sns_feedback_metrics_required` を返し、status は `posted` のまま。
- **検証**: `tests/server/routes/sns-growth.test.js`

## Anti-patterns

- **AP-1**: raw metrics を Graph SSOT に直接書く。
  - **理由**: Graph は durable knowledge のSSOTで、投稿運用のworkflow queueではない。
  - **検証**: APIは Ledger repository のみを更新する。
- **AP-2**: 投稿削除済み record を learning_ready に進める。
  - **理由**: 削除判断も運用履歴だが、成功学習として混ぜると次回推薦を歪める。
  - **検証**: UIは deleted status に mutation actions を出さない。

## Verification

| Clause | Test | Status |
|---|---|---|
| INV-1, INV-2, S-1, S-2 | `tests/server/routes/sns-growth.test.js` | ✅ |
| INV-3, INV-4, S-1, AP-2 | `tests/ui/views/sns-growth-cockpit-view.test.js` | ✅ |
