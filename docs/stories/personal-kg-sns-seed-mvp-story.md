---
story_id: str.brainbase.personal-kg-sns-seed-mvp
title: Personal KG can seed SNS drafts
status: implemented
date: 2026-05-12
related_specs:
  - SPEC-personal-kg-sns-seed-mvp
  - SPEC-sns-readonly-curator
---

# Story: Personal KG to SNS Seed MVP

## User Story

As a growth operator for さとけい,
I want personal knowledge graph memories to become SNS draft seeds,
so that posts come from accumulated thinking, proof, and persona understanding instead of a one-off prompt.

## Context

ADR-007 defines the personal graph as owner-visible Graph SSOT entries plus personal-scope candidate-store cognitive memory. M1-M4 already created candidate-store and an SNS read-only curator, but the curator currently depends on an abstract Graph reader. The missing slice is a concrete read model that turns personal KG memory into source entities for SNS curation.

## Business Context

The SNS operation is not "AI writes posts through an API." The operational value is that brainbase remembers the founder's proof, philosophy, mistakes, and preferences, then recommends post seeds with Persona Brain review evidence.

## Acceptance Criteria

- [x] AC-1: owner-visible candidate-store cognitive memories can be read as personal KG source entities.
- [x] AC-2: the read model excludes other owners, redacted memories, rejected/expired memories, and `agency_level=none`.
- [x] AC-3: personal KG source entities preserve provenance back to candidate-store evidence / source events.
- [x] AC-4: SNS read-only curator can generate Persona Brain drafts from the personal KG read model.
- [x] AC-5: saving the SNS draft still writes through candidate-store and does not post.

## Non-goals

- Do not write directly to production Graph in this story.
- Do not add X posting, scheduling, or quote repost execution.
- Do not make `_codex/sns/drafts/` the durable output path.
