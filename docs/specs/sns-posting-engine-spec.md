---
spec_id: SPEC-sns-posting-engine
title: SNS Posting Engine (M4-2)
status: draft
date: 2026-05-11
story_id: str.brainbase.sns-posting-engine
related_adrs: [ADR-008]
related_specs: [SPEC-sns-account-management, SPEC-account-foundation, SPEC-candidate-store-mvp]
implementation_files:
  - server/services/sns/posting-service.js
  - server/services/sns/scheduler-service.js
test_files:
  - tests/sns/posting/**/*.test.js
---

# SPEC: SNS Posting Engine

## 目的

candidate-store の approve 済 draft（promoted_to_graph）または直接指定された body を、account を選んで実投稿する内製エンジン。旧 sns_post.py / scheduled_post_runner.py 相当。

## Invariants

- INV-1: 投稿実行前に `AccountService.canUseForPost(account_id, actor)` を必ず呼ぶ。
- INV-2: draft が candidate-store 由来の場合、`promotion_status=promoted_to_graph` でなければ投稿不可。
- INV-3: 投稿成功時 `USED_FOR_POST` audit、`postTweet` から得た tweet_id を Graph event entity (type=event) に書く（後の feedback-loop が参照）。
- INV-4: scheduler は in-memory（テスト用）。schedule(post_at) で時刻指定可、`tick(now)` で due な job を発火。
- INV-5: dry_run mode は X API を呼ばず、シミュレート結果を返す（actual postTweet 呼び出しなし）。
- INV-6: rate limit が超過していたら post せず queued 状態を返す。

## Contracts

```ts
class PostingService {
  constructor({ accountService, providerRegistry, graphWriter, scheduler? })
  async post(actor, { account_id, body, source_candidate_id?, dry_run? }): Promise<{posted: boolean, tweet_id?: string, reason?: string}>
  async schedule(actor, { account_id, body, post_at, source_candidate_id? }): Promise<{job_id: string}>
}

class SchedulerService {
  schedule(job): string  // returns job_id
  tick(now: Date, executor: (job) => Promise<void>): Promise<{fired: number}>
  cancel(job_id): void
}
```

## Scenarios

- S-1: post happy path → tweet_id 取得、USED_FOR_POST audit、graph event 書き
- S-2: account=disabled で post → deny status
- S-3: dry_run で post → tweet_id は dummy、X API 呼ばない
- S-4: schedule → tick が due 時刻で execute
- S-5: source_candidate_id 指定で candidate が promoted_to_graph 以外 → reject

## Anti-patterns

- AP-1: canUseForPost を呼ばず直接 postTweet
- AP-2: dry_run なのに X API を呼ぶ

## Verification

| Clause | Test | Status |
|---|---|---|
| INV-1〜6, S-1〜5, AP-1〜2 | tests/sns/posting/**/*.test.js | ✅ |

合計 13 test files。
