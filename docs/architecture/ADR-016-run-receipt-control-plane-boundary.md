---
adr_id: ADR-016
title: Cross-runtime run receipt control-plane boundary
status: accepted
date: 2026-07-15
related_stories:
  - story-cross-runtime-run-receipt-inbox-v1
related_docs:
  - docs/stories/story-cross-runtime-run-receipt-inbox-v1.md
  - docs/architecture/story-cross-runtime-run-receipt-inbox-v1.md
  - docs/specs/cross-runtime-run-receipt-inbox-v1.md
  - docs/stories/story-external-runner-adapter-contract-v0.md
supersedes: []
superseded_by: []
---

# ADR-016: Cross-runtime run receipt control-plane boundary

## Context

Brainbase must observe operational runs owned by Mana, Codex Automations, GitHub Actions, and SalesTailor. Existing `external_runner.v0` is a rich Eve/Role Agent contract that owns context snapshots, human steps, outputs, rounds, Judgment DAG trace, and learning candidates. Generic jobs do not all have those concepts.

Routing every source through Mana would turn Mana into an accidental integration control plane. Copying source logs into Brainbase would create competing log stores and expand the privacy boundary.

## Decision

Brainbase owns the canonical operational receipt contract and Agent Run Inbox. Each source owns its connector, retry/outbox behavior, source API credentials, and raw evidence.

`run_receipt.v1` is a separate, thin contract. It maps into the existing Workflow Mission Control workflow/run/audit ledger; it does not create a second run SSOT. `external_runner.v0` remains the rich Eve contract. Both adapters converge only after contract-specific validation.

Idempotency is scoped by `project_id + source.type + external_run_id`. Brainbase stores normalized status, evidence state, metrics, summaries, and references. It does not store raw logs or customer content.

The deterministic receipt identity is the idempotency lock scope. Brainbase acquires it before duplicate lookup, then enters a repository-wide write transaction before inspecting or mutating the shared ledger. The repository-wide transaction serializes distinct receipt identities and every production shared-ledger writer; the JSON repository reloads under its file-wide lease, defers persistence, and commits the complete transaction once. Rollback restores process memory only and never writes a stale snapshot over another commit. Lock ordering is always receipt identity first and shared-ledger transaction second; shared-ledger transactions never acquire receipt identity locks. Brainbase stores a digest of the immutable contract/source/run projection and excludes delivery retry metadata from duplicate equality.

Repository transactions are context-aware and reentrant. A nested transaction invoked by the same async owner joins the outer transaction without reacquiring the queue or file lease; only the outermost owner snapshots, reloads, persists, or restores. Any nested failure marks the owner rollback-only, so catching the inner error cannot accidentally commit partial state. Unrelated async owners remain serialized. File-lease acquisition is bounded, a live owner is never stolen, and stale recovery requires both an expired lease and proof that the recorded local process no longer exists. Production JsonFile mutators reject calls outside an active transaction before changing memory. WorkflowService, WorkflowRunner, external_runner, and other production writers use short transaction callbacks around persistence only; remote handlers, network I/O, and long waits run outside the file lease.

The tuple is canonically encoded and hashed before use as a delivery key or WMC identifier, so separators inside source values cannot collide. WMC internal workflow identity is separately derived from `project_id + source.type + source.workflow_id`; original source identities remain metadata.

Source unavailability without a source run identity is represented as a connector-owned observation attempt, not as a fabricated source run failure. POST ingest remains server-to-server only; GET Inbox is an authenticated operator read constrained by the actor's project scope.

Graph SSOT is outside the receipt write path. A later, explicit human-reviewed learning flow may promote decisions derived from receipts.

## Consequences

- Mana is one connector, not the hub for Codex, GitHub Actions, or SalesTailor.
- Source run result and receipt delivery result remain separate facts.
- Source unavailability is represented explicitly and cannot become an empty success metric.
- Existing Workflow Mission Control authorization, project boundary, persistence, and audit surfaces are reused.
- Shared JSON persistence gains one repository-wide transaction boundary so receipt, external runner, WorkflowService, WorkflowRunner, and other production writers cannot overwrite each other.
- Existing nested WorkflowService transaction paths remain live through same-owner reentrancy instead of deadlocking on the queue.
- Connector Stories can evolve independently while sharing one versioned receipt contract.

## Rejected Alternatives

- Reuse `external_runner.v0`: rejected because it forces Eve-specific role/round/learning semantics on generic jobs.
- Create a standalone receipt database: rejected because Workflow Mission Control already owns operational run facts.
- Route all receipts through Mana: rejected because it couples independent runtime availability and credentials.
- Copy raw source logs: rejected because source systems remain evidence authorities.

## Verification

- Contract and adapter unit tests prove validation, mapping, idempotency, and conflict behavior.
- Route tests prove server-to-server auth and project boundaries.
- Inbox tests prove priority/filter semantics and explicit evidence states.
- Workflow Mission Control UI tests prove uncertainty is visible and API/UI ordering agrees without changing non-receipt workflow priority.
- Existing `external_runner.v0` tests remain green.
- Repository tests prove same-owner nested transaction completion, rollback-only propagation, bounded lease timeout/stale recovery, transaction-outside-write rejection, and preservation across receipt, external-runner duplicate replay, WorkflowService, and WorkflowRunner races.
