---
spec_id: SPEC-sns-feedback-loop
title: SNS Feedback Loop (M4-3)
status: active
date: 2026-05-11
story_id: str.brainbase.sns-feedback-loop
related_adrs: [ADR-008, ADR-011]
related_specs: [SPEC-sns-posting-engine, SPEC-sns-readonly-curator]
implementation_files:
  - server/services/sns/feedback-service.js
  - server/services/sns/feedback-learning-service.js
  - server/routes/sns-growth.js
  - public/modules/ui/views/sns-growth-cockpit-view.js
test_files:
  - tests/sns/feedback/**/*.test.js
  - tests/sns/feedback-learning/feedback-learning-service.test.js
  - tests/server/routes/sns-growth.test.js
  - tests/ui/views/sns-growth-cockpit-view.test.js
---

# SPEC: SNS Feedback Loop

## 目的

投稿後の反応（impressions / likes / replies / reposts / bookmarks）を SNS Posting Ledger に蓄積し、レビュー後に learning candidate として candidate-store へ渡す。

ADR-011 に従い、raw metrics は Graph SSOT に直書きしない。Graph に戻すのは、投稿・反応・読者感情を踏まえて人間がレビュー可能な learning candidate に変換した後だけにする。

## Invariants

- INV-1: metrics は SNS Posting Ledger の `metrics_snapshots` に append し、既存 snapshot を破壊しない。
- INV-2: `posted` record は metrics 記録後に明示操作で `learning_ready` へ遷移できる。
- INV-3: `deleted` record は learning handoff 対象に含めない。
- INV-4: learning handoff は candidate-store 経由で作成し、Graph へは promotion gate 後にのみ反映する。
- INV-5: 異常検知（impressions > 1000 かつ replies/impressions > 10%）は anomaly 通知 callback を発火する。

## Contracts

```ts
class FeedbackService {
  constructor({ xClient, graphWriter, anomalyNotifier })
  async pollMetrics(account_id, tweet_id, credential_ref): Promise<{written: number, anomaly: boolean}>
  async updateSourceEntityReuse(source_entity_id): Promise<void>
}

POST /api/sns-growth/posts/:id/feedback
body: {
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
returns: { post }
```

## Scenarios

- S-1: SNS Growth UI で posted record に metrics を記録し、learning_ready へ進める
- S-2: 二度目の metrics 記録でも snapshot を append（既存 snapshot を mutation せず）
- S-3: 炎上 threshold 超過で anomalyNotifier 呼ばれる
- S-4: learning_ready record から candidate-store に observation candidate を作成する

## Anti-patterns

- AP-1: 既存 metrics snapshot を update / delete する
- AP-2: anomaly が出ても通知せず黙る
- AP-3: raw metrics を Graph SSOT に直書きする

## Verification

| Clause | Test | Status |
|---|---|---|
| INV-1〜5, S-2〜4, AP-1〜3 | tests/sns/feedback/**/*.test.js, tests/sns/feedback-learning/feedback-learning-service.test.js | ✅ |
| S-1 | tests/server/routes/sns-growth.test.js, tests/ui/views/sns-growth-cockpit-view.test.js | ✅ |

次に残る実運用タスクは、X API polling と anomaly notifier の production wiring。
