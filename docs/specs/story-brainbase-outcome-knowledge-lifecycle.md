# Spec: canonical knowledge lifecycle and history

- Story: `story-brainbase-outcome-knowledge-lifecycle`
- Outcome: an authorized project member can retire or reactivate a canonical decision without losing history or silently overwriting a concurrent change.
- API: `POST /api/knowledge/items/:id/lifecycle`, `GET /api/knowledge/items/:id/history`

## Contract

- Mutation requires `project_code`, the exact opaque `expected_version`, `state=active|retired|unlinked`, and a non-empty `reason`. `unlinked` removes the decision from normal project retrieval while retaining its canonical row and audit history.
- The Graph update matches canonical ID, decision type, project, and expected version in one statement. A changed version returns `409 knowledge_lifecycle_version_conflict` with the current version and has no mutation.
- Each successful transition receives a new opaque server version, advances the Graph row version, updates `lifecycle_status`, `semantic_state`, and `status`, and appends actor, reason, from/to versions, and timestamp to immutable history.
- Normal discovery excludes retired decisions. Explicit inactive discovery and history remain available to authorized principals.
- Organization, actor, and accessible projects come only from authenticated access context; lifecycle history is protected by organization/project RLS.

## Verification

- Normal: retire and reactivate each append one history entry and produce a new version.
- Boundary: clients preserve the opaque version without parsing or incrementing it.
- Failure: wrong project, stale version, missing reason, unknown state, or unknown decision returns an explicit error and appends no history.
