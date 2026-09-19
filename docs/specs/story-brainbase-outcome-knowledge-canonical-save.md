# Spec: canonical knowledge save and readback

- Story: `story-brainbase-outcome-knowledge-canonical-save`
- Outcome: a complete decision draft becomes canonical only after authority verification, immutable event persistence, Graph persistence, exact content/version readback, and retrievable index state.
- API: `GET /api/knowledge/authority-domains`, `POST /api/knowledge/drafts/:draftId/save`

## Contract

- Request requires `project_code`, current draft `revision`, caller-generated `idempotency_key`, and `decision_domain`.
- `decision_domain` is a Graph RACI authority domain, not the draft applicability scope. Clients obtain the authenticated person's available values from `GET /api/knowledge/authority-domains?project_code=...`; an empty list remains an explicit lack of authority and is never replaced with `project` or `organization`.
- Canonical IDs are assigned deterministically by Brainbase. Caller-provided `canonical_id` is rejected so a new save cannot overwrite an existing decision or reset its version.
- `decision_authority.authorized` is not sufficient authority. The existing Knowledge Event ingestion path verifies the authenticated person against Graph decision authority/RACI before Graph mutation; an unverified decision is quarantined and save remains incomplete.
- Retry with the same idempotency key and draft revision returns the stored receipt. Reuse for another draft/revision returns `409`. A saved draft without the matching receipt is a conflict, not guessed success.
- Before canonical mutation, the repository atomically claims the draft revision, idempotency key, and decision domain. While `saving`, edits, discard, a different save key, or a changed decision domain conflict; the same request can resume after an interruption.
- Success requires all of: event saved, Graph entity saved, canonical ID/version/content exact readback, and `processing_stage=retrievable`.
- Response includes `expected_version`, `canonical_content_hash`, and independent `persistence.event_saved`, `graph_saved`, `readback_verified`, and `index_state`. ID-only readback never proves success.
- v1 canonical save supports decisions. Documents return `503 knowledge_document_save_unavailable` until a canonical document writer is configured.

## Recovery

The event ID is deterministic for draft+revision. A crash after event/Graph persistence can retry the same event id without duplicating the canonical write. The durable save receipt is committed only after exact readback.

## Verification

- Normal: exact content/version becomes retrievable and a durable save receipt is recorded.
- Boundary: duplicate retry is idempotent; mismatched key/revision conflicts.
- Failure: authority failure, quarantine, content/version mismatch, missing receipt, or non-retrievable index state never marks the draft saved.
