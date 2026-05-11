---
adr_id: ADR-010
title: Memory Promotion Kernel boundary for candidate-store, mana, and zeims
status: accepted
date: 2026-05-11
related_stories:
  - str.brainbase.candidate-store-mvp
  - STR-006
related_docs:
  - docs/stories/knowledge-graph-kernel-story-map.md
  - docs/stories/STR-006-mana-secretary-memory-promotion.md
  - docs/specs/candidate-store-mvp-spec.md
  - docs/specs/mana-secretary-memory-promotion-spec.md
  - docs/architecture/ADR-006-brain-model-4-layer.md
  - docs/architecture/ADR-008-acl-vocabulary.md
supersedes: []
superseded_by: []
---

# ADR-010: Memory Promotion Kernel boundary

## Context

M5 production connection needs a decision on the relationship between:

- `candidate-store-mvp` from the knowledge-graph-kernel line
- `STR-006` / mana secretary memory promotion
- zeims and other product-side memory sources that will later emit learning events

`candidate-store-mvp` and `STR-006` both describe the same center pin: raw activity is converted into memory candidates, candidates pass a Promotion Gate, and only approved output is written to Graph SSOT. Keeping them as separate promotion pipelines would create two sources of truth for candidate state, audit, redaction, and ACL.

At the same time, M5-A is already high impact because it introduces production PostgreSQL schema migration and a Pg-backed repository. Pulling mana / zeims physical integration into the same slice would couple schema rollout with cross-repo ingestion behavior and make the first production step too broad.

## Decision

`candidate-store` is the canonical **Memory Promotion Kernel** for brainbase.

mana, zeims, SNS feedback, and future product sources are not separate promotion systems. They are source adapters or participant systems that emit Raw Ledger-compatible envelopes into the same candidate-store contract.

### Scope for M5-A

M5-A includes:

- migrating the brainbase-owned candidate-store schema
- migrating the brainbase-owned integration-account schema
- adding Pg-backed repository contract tests
- making the repository implementation swappable by DI/config
- preserving existing in-memory tests

M5-A does not include:

- importing mana Slack / workflow history into production
- merging mana storage into brainbase storage
- changing zeims runtime behavior
- adding new Graph catalog types for mana or zeims
- enabling autonomous cross-product memory promotion

### Integration boundary

The shared boundary is the Raw Ledger envelope and Candidate record contract, not a shared physical database.

Source systems must provide:

- `source_system`
- `source_event_id`
- `occurred_at`
- `captured_at`
- actor identity, or a resolvable external actor
- workspace / channel / project scope where applicable
- permission snapshot
- evidence pointer, not raw transcript copied into Graph

The Memory Promotion Kernel owns:

- candidate persistence
- deduplication
- PII / secret block records
- promotion state transitions
- audit events
- redaction status
- Graph promotion eligibility
- deny-by-default retrieval boundary

## Consequences

- `candidate-store-mvp` remains the implementation path for STR-006 First Slice.
- mana integration should be implemented as a later adapter story after PgRepo contract tests pass.
- zeims integration should follow the same adapter shape and must not create a product-local promotion gate.
- M5-A can proceed without waiting for Q4 cross-repo implementation details.
- A future mana / zeims adapter can be tested against the same repository contract and ACL matrix.

## Non-Goals

- This ADR does not authorize production import of mana history.
- This ADR does not authorize production posting or SNS anomaly response.
- This ADR does not decide whether all four organization brains live in one instance; that remains Q1.
- This ADR does not decide whether low-risk reused SNS drafts can auto-post; that remains Q2.
- This ADR does not decide the anomaly notification or stop authority; that remains Q3.

## Verification

Before production migration:

- Pg repository contract tests must prove parity with `InMemoryCandidateRepository`.
- Existing candidate-store, account, and SNS posting tests must continue to run against in-memory repositories.
- Schema migration must be idempotent.
- No Graph writer may read unpromoted candidate rows as Graph SSOT.

For later mana / zeims adapter work:

- Adapter fixtures must produce Raw Ledger-compatible envelopes.
- Adapter tests must prove source evidence survives into `source_event_ids` / `evidence_ids`.
- Cross-source deduplication must be explicit and audited.
- Promotion remains blocked while `redaction_status = needs_redaction`.
