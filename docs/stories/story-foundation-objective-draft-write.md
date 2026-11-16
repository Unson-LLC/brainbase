---
story_id: story-foundation-objective-draft-write
title: Save Objective drafts through the canonical Graph writer
status: in_progress
---

# Save Objective drafts through the canonical Graph writer

An authenticated user can create or edit an Objective draft in the shared editor and read the saved canonical revision back, without gaining adoption or execution authority.

## Acceptance criteria / smallest testable specification

- A host may opt into a `writeObjectiveDraft` port on the Graph Foundation handler. Without it, writes remain explicitly unavailable.
- The adapter accepts only Objective domain proposals. It constructs a new private ACL, selected-project scope, candidate storage, draft-only use and editor provenance from trusted context. Updates preserve all existing authority fields and require the current revision.
- The canonical host writer remains responsible for transaction-bound tenant/project access, current ACL, Ontology validation, create-only/CAS semantics and immutable history. The adapter verifies the exact saved revision/digest before the host transaction commits. Rejected mutations roll back.
- Cross-project requests, spoofed authority, non-draft adoption and invalid dates are rejected before writing. A fully blank evaluation period remains absent, allowing an incomplete draft.
- Repeated saves cannot issue concurrent writes. Cancel or a newer selection cannot be overwritten by a stale asynchronous read/save result. A repeat create of the same id cannot overwrite the existing Objective.

## Boundaries and verification

This connects the existing Foundation draft contract; it adds no database schema, authentication provider, credential, maintenance bypass or deployment mechanism. The host owns organization identity and current row access; the OSS adapter never infers them from the body. Existing read/provider behavior stays compatible.

Focused coverage: `tests/foundation-graph-objective-write.test.ts`, existing Graph HTTP/write/read tests, immutable-history integration tests, and shared Objective editor/HTTP-port tests. Graphify is not installed in the implementation environment; source imports and affected tests were inspected instead. Full-suite CI, the published package, host and web release SHAs, and authenticated production UI readback remain separate evidence.
