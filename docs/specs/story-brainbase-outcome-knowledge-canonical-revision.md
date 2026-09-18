# Spec: canonical decision body revision

- Story: `story-brainbase-outcome-knowledge-canonical-revision`
- Outcome: an authorized project member can revise a canonical decision body without changing its canonical identity or losing the prior body.
- API: `POST /api/knowledge/items/:id/revisions`, `GET /api/knowledge/items/:id/history`

## Contract

- Mutation requires `project_code`, the exact opaque `expected_version`, caller-generated `idempotency_key`, a non-empty `reason`, and non-empty `content`. `title` is optional.
- The existing decision authority/RACI check runs before mutation. The Graph update matches canonical ID, decision type, project, and expected version in one statement.
- A successful revision preserves the canonical ID, assigns a new opaque server version, advances the Graph row version, refreshes the content hash, and reactivates searchability.
- Immutable revision history records actor, reason, from/to versions, and complete before/after snapshots. History is protected by organization/project RLS.
- The same idempotency key returns the prior result only when expected version, content, and supplied title are identical. Changed input returns `409 knowledge_revision_idempotency_conflict`.
- Success requires exact canonical ID/version/content/hash readback. Graph remains the decision SSOT; this endpoint does not make Graph a document-body store.
- Revision changes the body of the same decision. Replacing one canonical decision with another is supersession and remains a separate lifecycle operation.

## Verification

- Normal: an authorized revision preserves ID, changes opaque version, and appends one before/after history entry.
- Boundary: an identical retry is idempotent and creates no second update; reuse with changed content conflicts.
- Failure: stale version, missing reason/content, authority failure, or readback mismatch never reports a completed revision.
