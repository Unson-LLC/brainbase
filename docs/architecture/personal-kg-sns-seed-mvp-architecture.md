---
architecture_id: arch-personal-kg-sns-seed-mvp
story_id: str.brainbase.personal-kg-sns-seed-mvp
title: Personal KG to SNS Seed MVP Architecture
status: draft
date: 2026-05-12
related_specs:
  - SPEC-personal-kg-sns-seed-mvp
  - SPEC-sns-readonly-curator
---

# Architecture: Personal KG to SNS Seed MVP

## Center Pin

Personal KG for this MVP is a read model over personal-scope candidate-store memory, not a new graph schema.

## Boundary

The boundary is server-side read-only curation:

```text
Raw Ledger / highlighted thought
  -> Dreaming
  -> candidate-store personal cognitive memory
  -> Personal KG read model
  -> SNS read-only curator
  -> candidate-store SNS claim candidate with Persona Brain
```

## Responsibilities

- Candidate-store owns cognitive memory and ACL.
- Personal KG reader adapts owner-visible candidate memories into source entities.
- SNS curator scores and turns source entities into draft candidates.
- Promotion Gate stores draft candidates and review evidence.

## SSOT

The durable source for personal cognitive memory remains candidate-store until a promotion gate maps it to a catalog Graph entity. The read model must not become a second writable source of truth.

## Constraints

- Read model must apply candidate-store ACL through `listCandidates`.
- Read model must additionally restrict this MVP to `visibility=owner`.
- Exclude redacted, rejected, expired, and `agency_level=none` records.
- Preserve provenance via `source_candidate_id`, `source_event_ids`, and `evidence_ids`.
- No production Graph write and no SNS posting side effect.
