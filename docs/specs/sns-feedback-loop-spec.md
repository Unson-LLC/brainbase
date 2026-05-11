---
spec_id: SPEC-sns-feedback-loop
title: SNS Feedback Loop (M4-3)
status: draft
date: 2026-05-11
story_id: str.brainbase.sns-feedback-loop
related_adrs: [ADR-008]
related_specs: [SPEC-sns-posting-engine, SPEC-sns-readonly-curator]
implementation_files:
  - server/services/sns/feedback-service.js
test_files:
  - tests/sns/feedback/**/*.test.js
---

# SPEC: SNS Feedback Loop

## 目的

投稿後の反応（impressions / likes / replies / retweets）を一定間隔で取得 → Graph event entity に accumulate → 異常値（炎上候補）を proactive 通知する。

## Invariants

- INV-1: metrics は Graph event entity (type=event, kind='sns_metric') として書く。
- INV-2: 同じ tweet_id への metrics 更新は新規 event を append（既存 event の mutation 禁止）。
- INV-3: 異常検知（impressions > 1000 かつ replies/impressions > 10%）は anomaly 通知 callback を発火。
- INV-4: curator scoring に feedback を反映するため、reuse_count を tweet 経由で source_entity に追記する hook を持つ。

## Contracts

```ts
class FeedbackService {
  constructor({ xClient, graphWriter, anomalyNotifier })
  async pollMetrics(account_id, tweet_id, credential_ref): Promise<{written: number, anomaly: boolean}>
  async updateSourceEntityReuse(source_entity_id): Promise<void>
}
```

## Scenarios

- S-1: pollMetrics で graph event を 1 件 append
- S-2: 二度目の pollMetrics でも append（既存 mutation せず）
- S-3: 炎上 threshold 超過で anomalyNotifier 呼ばれる
- S-4: updateSourceEntityReuse で reuse_count インクリメント

## Anti-patterns

- AP-1: 既存 event を update / delete する
- AP-2: anomaly が出ても通知せず黙る

## Verification

| Clause | Test | Status |
|---|---|---|
| INV-1〜4, S-1〜4, AP-1〜2 | tests/sns/feedback/**/*.test.js | ✅ |

合計 10 test files。
