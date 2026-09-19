# Spec: knowledge capture drafts

- Story: `story-brainbase-outcome-knowledge-capture`
- Outcome: an authenticated project member can preserve incomplete knowledge input, resume it, edit with optimistic concurrency, or discard it without creating canonical knowledge.
- API: `POST /api/knowledge/drafts`, `GET|PATCH /api/knowledge/drafts/:draftId`, `POST /api/knowledge/drafts/:draftId/discard`

## Contract

- `project_code` is required and must be present in authenticated `req.access.projectCodes`.
- Organization, owner person, and accessible projects come only from authenticated access context.
- `title` and `content` may be empty while status is `draft`; canonical save validates completeness separately.
- Unknown `kind` is rejected rather than normalized to `decision`.
- Every update and discard supplies the last observed positive integer `revision`. A stale revision returns `409 knowledge_draft_revision_conflict` and applies no change.
- Draft rows are owner- and organization-scoped by PostgreSQL RLS. Discard is a retained terminal state, not physical deletion.

## Verification

- Normal: title-only input is saved and resumed.
- Boundary: editing may deliberately clear title/content back to empty.
- Failure: inaccessible project, spoofed owner context, unknown kind, stale revision, and edits after save/discard fail explicitly.
