---
architecture_id: arch-sns-persona-brain-gate
story_id: story-sns-persona-brain-gate
title: SNS Persona Brain Gate Architecture
status: draft
date: 2026-05-11
related_specs:
  - SPEC-sns-readonly-curator
---

# Architecture: SNS Persona Brain Gate

## Boundary

Persona Brain is part of the SNS curation boundary. It is not a posting concern, scheduler concern, or feedback metrics concern.

The curator may synthesize draft recommendations, but every recommendation must carry an explicit persona mental model before it can move to candidate-store.

## Responsibilities

- Graph reader: provides source entities and provenance.
- SNS curator: filters sources, scores candidates, attaches / validates persona brain, and writes reviewable candidates.
- Candidate-store: stores the draft candidate and its evidence snapshot for later review / promotion.
- Posting engine: consumes only promoted candidates and does not infer persona brain.

## Data Flow

```text
Graph source
  -> SNS curator source filter
  -> deterministic scoring
  -> persona brain gate
  -> candidate-store claim with permission snapshot and evidence
  -> promotion / review
  -> posting engine
```

## SSOT

The durable source for recommended SNS drafts remains candidate-store. Persona Brain is stored as review evidence attached to the candidate write, not as a separate file in `_codex`.

## Design Constraints

- The gate must fail before candidate-store mutation when persona brain is missing or incomplete.
- Persona brain validation must be deterministic.
- The curator must remain posting read-only.
- Existing in-memory tests continue to run without external Graph, X API, or PostgreSQL.
