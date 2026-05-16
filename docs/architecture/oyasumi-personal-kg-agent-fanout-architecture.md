---
story_id: str.brainbase.oyasumi-personal-kg-agent-fanout
title: Oyasumi Personal KG agent fan-out architecture
status: draft
date: 2026-05-16
---

# Architecture: Oyasumi Personal KG agent fan-out

## Decision

`/oyasumi` は個人KG抽出の実作業者ではなく、coordinatorとして振る舞う。
会議データは role-based agent pipeline に渡し、agent report をfan-inしてcandidate-storeへ書く。

## Pipeline

```text
raw sources
  -> meeting_harvester
  -> personal_kg_extractor
  -> sensitivity_reviewer
  -> sns_projection
  -> candidate-store writer
```

## Responsibility Boundary

| Component | Responsibility |
|---|---|
| Oyasumi Coordinator | date/repo/path決定、agent fan-out/fan-in、summary reporting |
| Meeting Harvester | minutes/transcript/source metadataをbundle化 |
| Personal KG Extractor | SNS化前のobservation/insight/claim/preference/hypothesis/resultを抽出 |
| Sensitivity Reviewer | private/confidential/sns_allowedを分類 |
| SNS Projection | SNSに流せるmemoryだけを短いcandidateへ投影 |
| Candidate Writer | promotion gate経由でidempotentに保存 |

## Data Model

candidateは従来の `memory_candidates` を使う。
追加の意味論は `permission_snapshot.oyasumi_meeting_personal_kg` に置く。

- `memory_layer`: `personal_kg_core` or `sns_ready`
- `agent_role`: 作成したagent role
- `source_kind`: `minutes` or `transcript`
- `projection_of`: `sns_ready` が参照する core rule id

## Rationale

個人KGはSNS投稿用の短文ではない。
先にcore memoryを作り、SNSはそこから投影する。
この分離により、投稿には使わないが今後のAI判断に効く思想、仮説、運用原則が保存される。

## Consequences

- candidate数は増えるが、memory_layerで用途を分けられる。
- SNS Generation Contextは当面 `sns_ready` と既存categoryを読む。
- 将来は `personal_kg_core` をGraph traversalやagent reasoningの入力として使える。
