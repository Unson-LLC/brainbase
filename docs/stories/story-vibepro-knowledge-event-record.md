# Story: VibePro verified Knowledge Event recording

## Background

Brainbase is the authority that determines the development Judgment and knowledge routes used by VibePro. After implementation, VibePro can produce a tamper-evident `knowledge_event.v1` only when computed verification still matches the exact Git state that consumed the Brainbase context.

The organization runtime already has an authenticated Knowledge Event API, an idempotent event registry, a candidate store, and a review-before-promotion boundary. The missing piece is a project-scoped MCP adapter that validates the VibePro envelope before sending it to that existing pipeline.

## User Story

As an organization using Brainbase and VibePro, I want verified implementation learning to return to Brainbase automatically as a reviewable candidate, so development knowledge compounds without letting VibePro self-authorize canonical Graph changes.

## Acceptance Criteria

1. The private Brainbase MCP publishes `brainbase_knowledge_event_record` as a write tool.
2. The tool accepts only a strict `knowledge_event.v1` development-learning candidate with Graph promotion and external action disabled.
3. The adapter recalculates the payload hash and deterministic event ID and verifies repository, Story, Git HEAD, subject, source pointer, and computed evidence bindings before authentication or API mutation.
4. The event project is resolved through the existing authenticated project scope; the exact event is sent to `POST /api/knowledge/events` with scoped authorization headers.
5. The backend response must preserve the same event ID, create or reuse a candidate, reach `retrievable`, remain `active`, and report no Graph entity. Any divergence fails closed.
6. An idempotent API replay returns `already_recorded`; no duplicate candidate is presented as a new write.
7. The MCP receipt exposes canonical `brainbase://` references and explicitly reports `candidate_only=true`, `graph_promoted=false`, and `external_action_executed=false` without leaking service tokens or local filesystem paths.
8. The existing Knowledge Event service remains the persistence authority. No new table, direct SQL path, Graph mutation, or automatic promotion path is added.
9. Focused adapter tests and the complete MCP regression suite pass.

## Verification

- `npm --prefix mcp/brainbase run build`
- `npm --prefix mcp/brainbase test`
- `npm test`
- `npm run check:architecture-model`
- `git diff --check`
