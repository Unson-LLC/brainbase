---
spec_id: SPEC-sns-learning-informed-generation
title: SNS Learning Informed Generation
status: draft
date: 2026-05-16
story_id: str.brainbase.sns-learning-informed-generation
related_specs:
  - SPEC-personal-kg-sns-weekly-planner
  - SPEC-sns-feedback-loop
  - SPEC-sns-x-algorithm-quality
implementation_files:
  - scripts/build-sns-generation-context.js
  - scripts/generate-sns-ohayo-brief.js
  - server/services/sns/sns-generation-context-service.js
test_files:
  - tests/sns/ops/sns-generation-context.test.js
  - tests/sns/ops/sns-ohayo-brief.test.js
---

# SPEC: SNS Learning Informed Generation

## Purpose

`ohayo` のSNS投稿生成前に、個人KG、SNS Posting Ledgerの過去投稿統計、SNS Strategy OS、feedback learning candidatesを合成した **SNS Generation Context** を作る。

このSpecの目的は、人間向けAnalytics UIを作ることではない。
AIが投稿生成時に、累積学習と戦略を踏まえた投稿案を作れるようにすることである。

## Invariants

- **INV-1**: SNS Generation Contextはprojectionであり、正本ではない。再生成可能でなければならない。
- **INV-2**: Personal KG / candidate-store、SNS Posting Ledger、SNS Strategy OSをそれぞれ正本として扱い、Context内で混ぜて上書きしない。
- **INV-3**: raw metricsはGraphへ直接書かない。SNS反応はcandidate-storeのlearning candidateを経由して学習に戻す。
- **INV-4**: Contextは人間向け詳細分析ではなく、AI生成用の `generation_policy` に変換される。
- **INV-5**: `generation_policy` は `recommended_lanes`, `avoid_patterns`, `winning_angles`, `needs_more_data`, `quote_target_policy` を持つ。
- **INV-6**: 投稿履歴統計は最低限、直近7日/30日の `lane`, `source_type`, `format`, `persona_affect`, `algorithm_fit` 単位で集計する。
- **INV-7**: `publish_failed`, `skipped`, `deleted` は勝ち筋統計に混ぜず、生成制約または再判断対象として別分類する。
- **INV-8**: `ohayo` はSNS Generation Contextを読んでdaily review packを作り、各draftに参照したContext evidenceを残す。
- **INV-9**: 公開投稿本文には統計、運用都合、AI投稿自動化感を出さない。

## Contract

```ts
type SnsGenerationContextInput = {
  date: string;
  lookbackDays?: number;
  viewer: {
    actor_person_id: string;
    org_ids: string[];
  };
};

type SnsGenerationContext = {
  date: string;
  strategy: SnsStrategyContext;
  personal_kg: PersonalKgContext;
  posting_stats: PostingStatsContext;
  learning: SnsLearningContext;
  generation_policy: SnsGenerationPolicy;
  evidence: Array<{ kind: string; ref: string }>;
};
```

### Required Policy Shape

```ts
type SnsGenerationPolicy = {
  recommended_lanes: string[];
  avoid_patterns: string[];
  winning_angles: string[];
  needs_more_data: string[];
  quote_target_policy: string[];
};
```

## Data Sources

| Source | Role | Boundary |
|---|---|---|
| Personal KG / candidate-store | 思想、proof、議事録由来memory、SNS feedback learning candidate | knowledge / candidate正本 |
| SNS Posting Ledger | 投稿本文、状態、posted URL、metrics snapshots | operational正本 |
| SNS Strategy OS | content pillars、tone guard、週次配分、distribution layer | hand-authored strategy正本 |
| SNS Generation Context | 生成用の合成ブリーフ | projection |

## Scenarios

### S-1: Context builder creates generation policy from cumulative learning

- given: 過去7日/30日のLedger recordsとSNS Strategy OSがある
- when: Context builderを実行する
- then: `posting_stats` と `generation_policy` が作られる
- and: `generation_policy` はAIが次の投稿を作るための制約として読める

### S-2: ohayo uses Context before draft generation

- given: `sns_generation_context.json` がある
- when: `ohayo` がdaily review packを作る
- then: draftはContextの `recommended_lanes`, `avoid_patterns`, `winning_angles` を踏まえる
- and: 各draftは使ったContext sectionをevidenceに残す

### S-3: Failed and skipped posts do not pollute winning patterns

- given: `publish_failed`, `skipped`, `deleted` のLedger recordsがある
- when: statsを集計する
- then: それらは勝ち筋統計から除外される
- and: `learning.publish_failed`, `learning.skipped`, `learning.deleted` に分類される

### S-4: Weak metrics become a better angle, not simple rejection

- given: あるlaneのimpressionsは弱いがPersona Affectはpassしている
- when: generation policyを作る
- then: laneを捨てるのではなく、Personal KG anchorや読者の誤解へ戻して別角度を提案する

## Non-goals

- 詳細Analytics UI
- Graphへのraw metrics直書き
- SNS Strategy OSの自動上書き
- X API投稿またはscheduler挙動の変更

## Verification

| Clause | Test |
|---|---|
| INV-1〜7, S-1, S-3, S-4 | `tests/sns/ops/sns-generation-context.test.js` |
| INV-8, S-2 | `tests/sns/ops/sns-ohayo-brief.test.js` |
| INV-9 | `tests/sns/weekly-planner/personal-kg-sns-weekly-planner.test.js` |
