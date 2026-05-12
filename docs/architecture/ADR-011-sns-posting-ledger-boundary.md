---
adr_id: ADR-011
title: SNS Posting Ledger boundary
status: accepted
date: 2026-05-12
related_stories:
  - story-sns-posting-cockpit
related_docs:
  - docs/stories/sns-posting-cockpit-mvp-story.md
  - docs/stories/knowledge-graph-kernel-story-map.md
  - docs/architecture/ADR-006-brain-model-4-layer.md
  - docs/architecture/ADR-010-memory-promotion-kernel-boundary.md
supersedes: []
superseded_by: []
---

# ADR-011: SNS Posting Ledger boundary

## Context

The SNS line can now generate reviewable posts from weekly content design, Personal KG memory, Peer Circle signals, news signals, Persona Brain, Graph Check, and deterministic quality gates.

Draft creation is no longer the center problem. The next operational problem is that posts need a durable place to move through review, schedule, posting, feedback, and learning states.

Two architectural boundaries must be fixed before implementation:

- whether this state belongs in Graph or in a separate operational store
- whether this store needs separate infrastructure or can run on the existing Lightsail PostgreSQL host

Graph is the SSOT for durable knowledge: people, organizations, brands, philosophy, decisions, terms, and promoted learnings. A daily SNS posting queue is not durable knowledge by itself. It is operational state. If draft body edits, schedule state, posted URLs, raw metrics, and review notes are stored directly as Graph entities, Graph becomes a task queue and loses its role as promoted knowledge.

At the same time, using a separate hosting platform for this first cockpit would add operational overhead before there is a scale reason. The existing Lightsail PostgreSQL host is already the production direction for candidate-store, integration accounts, and Graph-adjacent services.

## Decision

SNS posting operations will use a separate **SNS Posting Ledger**.

The SNS Posting Ledger is not Graph SSOT. It is an operational ledger that stores draft, review, schedule, posting, metrics, and learning-candidate linkage state.

The ledger will run on the same Lightsail PostgreSQL infrastructure as brainbase production data, but in tables or schema separated from Graph SSOT tables.

## Boundaries

### Graph SSOT owns durable knowledge

Graph remains responsible for:

- people and organizations
- brand and account identity
- philosophy and operating principles
- glossary terms
- decisions and accepted architecture
- promoted learnings after candidate-store approval

Graph does not own:

- draft queue state
- review status
- scheduled datetime
- edited post bodies before promotion
- raw metrics snapshots
- temporary source candidates

### SNS Posting Ledger owns operational state

The ledger owns:

- generated date and slot
- post body and revisions
- source references
- Persona Brain / Graph Check / Quality Gate snapshots used at review time
- review status and reviewer actions
- scheduled datetime
- posted URL
- metrics snapshots
- learning candidate references

The ledger may store evidence snapshots from Graph or candidate-store, but those snapshots do not become Graph truth.

### Candidate-store owns promotion

When a posted result produces reusable learning, the feedback flow creates a candidate-store learning candidate. Promotion into Graph happens only through the existing Memory Promotion Kernel boundary from ADR-010.

Raw metrics do not write directly into Graph.

## Operational Model

The default post state flow is:

```text
/ohayo review pack
  -> SNS Posting Ledger: review_needed
  -> operator review/edit
  -> approved
  -> scheduled
  -> posted
  -> learning_ready
  -> candidate-store learning candidate
  -> Graph promotion gate
```

The MVP may allow manual posting on X with a posted URL pasted back into brainbase. Full X API posting is a later execution layer and must still write through the same ledger.

## Infrastructure Decision

The ledger will use existing Lightsail PostgreSQL infrastructure.

This is an infrastructure co-location decision, not a data-boundary collapse:

- same PostgreSQL host is acceptable
- separate tables/schema are required
- Graph table writes remain promotion-only
- repository boundaries must make accidental Graph writes hard
- migrations must be idempotent

## Consequences

- SNS Cockpit implementation can start with a clear DB/API boundary.
- The UI can show calendar, review, schedule, and posted states without overloading Graph.
- `/ohayo` can persist review packs idempotently without changing Graph semantics.
- `/oyasumi` can read posted records and create learning candidates without direct Graph mutation.
- Future X API posting can be added as an execution adapter over the ledger.
- Future multi-account / agency workflows can extend the ledger model without changing Graph taxonomy first.

## Alternatives Considered

### Store all posts as Graph event entities

Rejected.

This would make Graph a workflow queue and force raw metrics, temporary drafts, and edited copy into a promoted-knowledge store. It also makes status churn and edit history look like semantic knowledge.

### Keep markdown / JSON files as the durable store

Rejected.

Markdown and JSON artifacts are useful for review and debugging, but they are not enough for calendar queries, status transitions, idempotency, metrics snapshots, or UI editing.

### Use a separate hosted database

Rejected for MVP.

The first version does not justify separate operational infrastructure. Lightsail PostgreSQL is enough, as long as schema/table boundaries are explicit.

### Auto-post directly from generated drafts

Rejected for MVP.

The current operating preference is "AI drafts, human reviews, brainbase manages." Full posting automation can come later, but review and ledger state must exist first.

## Non-Goals

- This ADR does not define the physical SQL schema.
- This ADR does not define the calendar UI layout.
- This ADR does not authorize unattended auto-posting.
- This ADR does not add a new Graph entity type for draft posts.
- This ADR does not decide multi-account agency support.

## Verification

Implementation stories must prove:

- `/ohayo` persistence is idempotent by date and slot.
- Status transitions are explicit and testable.
- Ledger writes do not mutate Graph tables.
- Posted URL and metrics snapshots can be stored without promotion.
- Learning promotion flows through candidate-store.
- Existing markdown/signals outputs continue to work during migration.
