---
spec_id: SPEC-sns-ohayo-dedupe-generation
title: SNS ohayo 重複回避生成 Specification
status: active
date: 2026-05-23
story_id: str.brainbase.sns-ohayo-dedupe-generation
related_specs:
  - SPEC-sns-persona-brain-gate
  - SPEC-personal-kg-sns-seed-mvp
implementation_files:
  - server/services/sns/sns-generation-context-service.js
  - scripts/generate-sns-ohayo-brief.js
test_files:
  - tests/sns/ops/sns-generation-context.test.js
  - tests/sns/ops/sns-ohayo-brief.test.js
---

# SPEC: SNS ohayo 重複回避生成

## Purpose

`/ohayo` must generate fresh review-pack drafts from Personal KG, posting history, and daily X signals. Duplicate-body prevention must happen before Ledger import, while the Ledger duplicate guard remains the final protection.

## Invariants

- **INV-1**: Generation Context exposes enough recent ledger history for deterministic dedupe: recent bodies, normalized body fingerprints, used source URLs, status, lane, title, and posted URL when present.
  - 検証: `tests/sns/ops/sns-generation-context.test.js`
- **INV-2**: `buildBrief` excludes review-pack posts whose normalized body is identical or near-identical to a recent ledger body.
  - 検証: `tests/sns/ops/sns-ohayo-brief.test.js`
- **INV-3**: `buildBrief` excludes peer/news posts whose source URL was already used in recent ledger history.
  - 検証: `tests/sns/ops/sns-ohayo-brief.test.js`
- **INV-4**: Dedupe holds are explicit in `reviewPack.holds` with `duplicate_recent_body` or `source_url_already_used`.
  - 検証: `tests/sns/ops/sns-ohayo-brief.test.js`
- **INV-5**: Ledger import duplicate-body protection remains unchanged.
  - 検証: existing SNS ledger route/import tests.

## Contracts

### Contract-1: Generation Context recent history

- **input**: ledger posts returned by `ledgerRepository.listPosts({ startDate, endDate })`
- **output**: `generation_policy.recent_history`
- **schema**:

```ts
type RecentHistoryItem = {
  id: string;
  date: string;
  status: string;
  lane: string | null;
  title: string | null;
  body: string;
  body_fingerprint: string;
  source_url: string | null;
  posted_url: string | null;
};

type RecentHistory = {
  lookback_start_date: string;
  lookback_end_date: string;
  posts: RecentHistoryItem[];
  used_source_urls: string[];
  blocked_body_fingerprints: string[];
};
```

### Contract-2: Ohayo dedupe gate

- **input**: candidate post body, optional source URL, `generationContext.generation_policy.recent_history`
- **output**: pass or hold reason
- **postconditions**:
  - identical normalized body is held as `duplicate_recent_body`
  - high-overlap normalized body is held as `near_duplicate_recent_body`
  - reused source URL is held as `source_url_already_used`
  - held posts are not added to `reviewPack.posts`

## Scenarios

### S-1: Recent body is blocked before Ledger import

- **given**: generation context contains a recent posted body matching the default baseline body
- **when**: `buildBrief` builds the review pack
- **then**: the duplicate body is absent from `reviewPack.posts`, and `reviewPack.holds` contains `duplicate_recent_body`
- **検証**: `tests/sns/ops/sns-ohayo-brief.test.js`

### S-2: Used source URL is not quoted again

- **given**: generation context contains a previously used source URL
- **when**: a peer/news signal uses the same URL
- **then**: that candidate is held with `source_url_already_used`
- **検証**: `tests/sns/ops/sns-ohayo-brief.test.js`

### S-3: Fresh alternatives still pass

- **given**: one baseline template is blocked but another Personal KG/topic variation is available
- **when**: `buildBrief` builds the review pack
- **then**: the review pack includes a non-duplicate baseline body with persona brain and quality gate evidence
- **検証**: `tests/sns/ops/sns-ohayo-brief.test.js`

## Anti-patterns

- **AP-1**: Depending on Ledger import skip as the first duplicate prevention layer.
  - **理由**: the UI appears stale and the operator cannot review alternatives.
- **AP-2**: Treating weekly lane labels as copy.
  - **理由**: the same lane may need different concrete claims on different days.
- **AP-3**: Reusing the same quote-commentary body while only changing the source URL.
  - **理由**: it reads automated and does not show the owner's thinking.

## Architecture Boundary

ADR不要。変更範囲は既存のSNS generation context serviceと`generate-sns-ohayo-brief.js`の生成前ガードに閉じる。永続化schema、SNS cockpit API、投稿実行runner、Ledger import duplicate guardは既存契約を維持する。

## Verification

| Clause | Test | Status |
|---|---|---|
| INV-1 | `tests/sns/ops/sns-generation-context.test.js` | pass |
| INV-2 | `tests/sns/ops/sns-ohayo-brief.test.js` | pass |
| INV-3 | `tests/sns/ops/sns-ohayo-brief.test.js` | pass |
| INV-4 | `tests/sns/ops/sns-ohayo-brief.test.js` | pass |
| INV-5 | existing SNS ledger tests | unchanged |
| S-1 | `tests/sns/ops/sns-ohayo-brief.test.js` | pass |
| S-2 | `tests/sns/ops/sns-ohayo-brief.test.js` | pass |
| S-3 | `tests/sns/ops/sns-ohayo-brief.test.js` | pass |
