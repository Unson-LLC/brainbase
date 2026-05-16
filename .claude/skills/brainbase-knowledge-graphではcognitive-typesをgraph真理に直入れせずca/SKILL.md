---
name: brainbase-knowledge-graphではcognitive-typesをgraph真理に直入れせずca
description: Knowledge Graphではcognitive typesをGraph真理に直入れせずcandidate-storeで扱う
---

# brainbase-knowledge-graphではcognitive-typesをgraph真理に直入れせずca

## Trigger
- Use when this pattern appears: Knowledge Graphではcognitive typesをGraph真理に直入れせずcandidate-storeで扱う

## Steps
- 1. raw activityはローカルまたはsource systemに残す
- 2. dreaming/ingestでcandidateを作る
- 3. PII/secret scanとpromotion gateを通す
- 4. private preferenceなど安全な一部だけauto-promote可能にする
- 5. Graphにはpromoted entity + derived_from/provenance edgeのみ書く
- 6. Meshはcentral Graphの代替にせず、各nodeにしかないlocal context問い合わせ専用にする

## Guardrails
- Do not override the linked wiki rule.
- Escalate if the current case contradicts the wiki guidance.

## Linked Wiki
- architecture/knowledge-graphではcognitive-typesをgraph真理に直入れせずca

## Source
- Promoted from explicit_learn / success