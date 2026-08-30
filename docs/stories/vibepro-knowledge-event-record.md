# VibePro Knowledge Event recording

## Background

Brainbase is the authority that resolves Judgment and project knowledge. VibePro consumes that resolved context while implementing a Story, but a verified development learning currently stops inside the VibePro workspace. Without a receiving contract, the learning cannot be audited by Brainbase and any direct write into Graph would bypass the human promotion boundary.

## User Story

As a Brainbase operator, I want a VibePro development learning to arrive as a tamper-evident, project-scoped candidate, so Brainbase can preserve the verified event without silently promoting it into canonical Graph knowledge or executing an external action.

## Acceptance Criteria

1. The MCP server publishes `brainbase_knowledge_event_record` as a strict tool whose input is one `knowledge_event.v1` event and an optional Brainbase data directory.
2. The tool accepts only VibePro development-learning candidates with `authorized=false`, `graph_promotion_allowed=false`, `external_action=false`, `graph_promotion=false`, `visibility=team`, and `sensitivity=internal`.
3. The receiver recalculates the payload body hash and deterministic event ID and rejects a mismatch before any write.
4. The receiver binds repository source, Story ID, Git HEAD, subject ID, verification evidence, and source pointer to the same event identity.
5. Only computed evidence sources (`runner_direct`, `ci_import`, `autopilot_run`) are accepted, and duplicate evidence labels are rejected.
6. Accepted events are stored append-only under the local runtime candidate store; an identical retry is idempotent and a conflicting or corrupt existing record fails closed.
7. Recording does not change `graph.json`, promote a canonical entity, or perform an external action. The receipt exposes these boundaries and never returns a local absolute path.
8. Sensitive summaries, control characters, malformed timestamps, cross-boundary authority expansion, and invalid source bindings are rejected.
9. Unit tests, the direct server contract, and stdio MCP startup verify the new tool while preserving all existing tool behavior.

## Verification

- `npm run build`
- `npm test`
- `npm run docs:check`
- `npm run docs:build`
- `npm run docs:smoke`
- `git diff --check`
