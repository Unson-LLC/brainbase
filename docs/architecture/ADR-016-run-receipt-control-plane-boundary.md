---
adr_id: ADR-016
title: Cross-runtime run receipt control-plane boundary
status: accepted
date: 2026-07-15
related_stories:
  - story-cross-runtime-run-receipt-inbox-v1
related_docs:
  - docs/stories/story-cross-runtime-run-receipt-inbox-v1.md
  - docs/architecture/ADR-017-agent-first-product-surface.md
  - docs/architecture/brainbase-surface-responsibility-matrix.md
  - docs/architecture/story-cross-runtime-run-receipt-inbox-v1.md
  - docs/specs/cross-runtime-run-receipt-inbox-v1.md
  - docs/stories/story-external-runner-adapter-contract-v0.md
  - docs/specs/story-external-runner-adapter-contract-v0-spec.md
supersedes: []
superseded_by: []
---

# ADR-016: Cross-runtime run receipt control-plane boundary

## Context

Brainbase must observe operational runs owned by Mana, Codex Automations, GitHub Actions, and SalesTailor. Existing `external_runner.v0` is a rich Cloudflare/computer and Role Agent contract that owns context snapshots, human steps, outputs, rounds, Judgment DAG trace, and learning candidates. Generic jobs do not all have those concepts.

Routing every source through Mana would turn Mana into an accidental integration control plane. Copying source logs into Brainbase would create competing log stores and expand the privacy boundary.

## Decision

Brainbase owns the canonical operational receipt contract and Agent Run Inbox. Each source owns its connector, retry/outbox behavior, source API credentials, and raw evidence.

`run_receipt.v1` is a separate, thin contract. It maps into the existing Automation Run/run/audit ledger; it does not create a second run SSOT. `external_runner.v0` remains the rich external-runtime contract. Both adapters converge only after contract-specific validation.

Idempotency is scoped by `project_id + source.type + external_run_id`. Brainbase stores normalized status, evidence state, metrics, summaries, and references. It does not store raw logs or customer content.

The deterministic receipt identity is the idempotency lock scope. Brainbase acquires it before duplicate lookup, then enters a repository-wide write transaction before inspecting or mutating the shared ledger. The repository-wide transaction serializes distinct receipt identities and every production shared-ledger writer; the JSON repository reloads under its file-wide lease, defers persistence, and commits the complete transaction once. Rollback restores process memory only and never writes a stale snapshot over another commit. Lock ordering is always receipt identity first and shared-ledger transaction second; shared-ledger transactions never acquire receipt identity locks. Brainbase stores a digest of the immutable contract/source/run projection and excludes delivery retry metadata from duplicate equality.

Repository transactions are context-aware and reentrant. A nested transaction invoked by the same async owner joins the outer transaction without reacquiring the queue or file lease; only the outermost owner snapshots, reloads, persists, or restores. Any nested failure marks the owner rollback-only, so catching the inner error cannot accidentally commit partial state. Unrelated async owners remain serialized. File-lease acquisition is bounded, a live owner is never stolen, and stale recovery requires both an expired lease and proof that the recorded local process no longer exists. Production JsonFile shared-ledger collection mutators reject calls outside an active transaction before changing memory. Receipt/workflow identity locks and transaction lease metadata are a separately synchronized control-plane surface: they are exempt from the collection guard, never live in `workflow-ledger.json`, and lock acquire/release never reload or replace shared-ledger memory. The in-memory repository likewise keeps identity locks outside its ledger snapshot.

Repository construction performs no ordinary unguarded seed mutation. Before a JsonFile repository is published to runtime services, a dedicated synchronous initialization transaction uses the same file-wide lease and transaction owner, reloads the current file, inserts only missing seed workflows, commits once, and releases in `finally`; concurrent existing content is preserved. Later default-automation repair uses the normal reentrant repository transaction. Specialized automation services, WorkflowRunner, external_runner, and other production writers use short transaction callbacks around persistence only; remote handlers, network I/O, candidate-store calls, and long waits run outside the file lease.

`external_runner.v0` learning candidates use a durable ledger outbox. The first short transaction stores the core run plus deterministic pending-candidate audit intents. Candidate Store creation then runs outside the lease with a collision-safe global id derived as `extcand_` plus lowercase SHA-256 over UTF-8 compact JSON `["external_runner.v0", workspace_id, org_id || "", project_id, runner.type, external_run_id, source_candidate_id]`. Candidate Store provenance is `source_event_ids=["external_runner_scope:" + sha256(compactJson(["external_runner.v0", workspace_id, org_id || "", project_id, runner.type, external_run_id])), source_candidate_id]`, so its existing source-event dedupe remains project/run scoped while the original source candidate id remains directly traceable; audit metadata also preserves the original id. Every Candidate Repository implementation rejects an existing primary candidate id with `DuplicateCandidateError` before mutation, even when the incoming source-event dedupe key differs, and preserves the original record. A following short transaction records `stored` or `deferred`; an existing exact run with pending intents resumes them without writing the legacy duplicate-replay audit. If creation reports a duplicate after a crash, Brainbase reads the derived id and adopts it only when the canonical immutable ingest-controlled projection matches; a missing or mismatched record appends audit action `external_runner.candidate_conflict`, leaves the pending intent actionable, and rejects with error code `external_runner_candidate_conflict` instead of marking it deferred. Retryable Candidate Store unavailability still becomes `deferred`; identity-integrity conflicts never do. Once every intent has converged, a later exact duplicate preserves the existing `external_runner.duplicate_replay_ignored` audit behavior inside one short shared-ledger transaction. Process interruption before or after Candidate Store creation is therefore retryable without duplicating a candidate or losing the WMC run.

The tuple is canonically encoded and hashed before use as a delivery key or WMC identifier, so separators inside source values cannot collide. WMC internal workflow identity is separately derived from `project_id + source.type + source.workflow_id`; original source identities remain metadata.

Source unavailability without a source run identity is represented as a connector-owned observation attempt, not as a fabricated source run failure. POST ingest remains server-to-server only; GET Inbox is an authenticated operator read constrained by the actor's project scope.

Graph SSOT is outside the receipt write path. A later, explicit human-reviewed learning flow may promote decisions derived from receipts.

## Consequences

- Mana is one connector, not the hub for Codex, GitHub Actions, or SalesTailor.
- Source run result and receipt delivery result remain separate facts.
- Source unavailability is represented explicitly and cannot become an empty success metric.
- Existing Automation Run authorization, project boundary, persistence, and audit surfaces are reused.
- Shared JSON persistence gains one repository-wide transaction boundary so receipt, external runner, specialized automation services, WorkflowRunner, and other production writers cannot overwrite each other.
- Existing nested Meeting Automation and automation-control transaction paths remain live through same-owner reentrancy instead of deadlocking on the queue.
- Connector Stories can evolve independently while sharing one versioned receipt contract.
- Agent Run InboxのCore契約と台帳は維持し、標準操作面はADR-017に従ってMCPとMac Companionへ移管する。Workflow Mission Control Web UIは2026-07-16に退役した。

## Rejected Alternatives

- Reuse `external_runner.v0`: rejected because it forces provider-specific role/round/learning semantics on generic jobs.
- Create a standalone receipt database: rejected because Automation Run Core already owns operational run facts.
- Route all receipts through Mana: rejected because it couples independent runtime availability and credentials.
- Copy raw source logs: rejected because source systems remain evidence authorities.

## Verification

- Contract and adapter unit tests prove validation, mapping, idempotency, and conflict behavior.
- Route tests prove server-to-server auth and project boundaries.
- Inbox tests prove priority/filter semantics and explicit evidence states.
- MCP contract tests and Mac Companion projection tests prove uncertainty is preserved, ordering is stable, and non-receipt automation priority is unchanged.
- Existing `external_runner.v0` tests remain green.
- Repository tests prove same-owner nested transaction completion, rollback-only propagation, bounded lease timeout/stale recovery, transaction-outside-write rejection, identity-lock isolation, lease-safe startup seeding, and preservation across receipt, external-runner duplicate replay, specialized automation services, and WorkflowRunner races.
- WorkflowRunner tests use a transaction-guarded repository to prove the initial and terminal mutation groups are separate atomic transactions, hold a fake remote handler open with no active transaction, and prove an unrelated repository transaction commits before the handler is released. External-runner tests interrupt each candidate outbox phase and prove deterministic resume without pending-replay duplicate audit, exact existing-candidate adoption after a store-before-finalize crash, mismatched existing-candidate conflict, source candidate-id separation across run/project scope, no orphaned duplicate, and the legacy duplicate audit only after full convergence. A controlled two-repository seed fixture proves initialization waits for the shared lease, reloads under it, inserts only missing seeds, and preserves the other writer's commit. Reconciler branch tests prove each update/audit group remains atomic.
