---
story_id: story-live-feed-current-session-scope
title: Live Feed current session scope
source_requirement:
  requirement_title: Live Feed should remind the user what the current session was doing
architecture_docs:
  - path: docs/architecture/live-feed-current-session-scope-architecture.md
    status: accepted
spec_docs:
  - path: docs/specs/live-feed-current-session-scope-spec.md
    status: active
reason: Live Feed already has activity-history projection; this story makes the primary UI match the user's monitoring workflow.
related_tasks: []
status: active
created_at: 2026-05-25
updated_at: 2026-05-25
---

# Live Feed current session scope

## Background

Brainbase users often run multiple AI sessions at the same time. The session list already answers "which session is active"; Live Feed must answer "what was this session doing, and what happened across all sessions when I need the global log."

The previous Live Feed surface put category filters and a timeline rail ahead of the user's primary workflow. That made it hard to switch between the currently opened session and the global activity log, and it spent too much horizontal space on timeline decoration rather than the actual prompt/activity text.

## Change

### Who

- Brainbase users monitoring multiple Claude Code / Codex sessions.

### What

- Default Live Feed to the currently selected session.
- Provide a compact two-choice scope control: `このセッション` and `全体`.
- Keep the underlying display as one chronological stream; scope changes only filter the same stream.
- Reduce timeline visual weight so the prompt/activity text is easier to scan.

### Why

- When a user opens a session, they should immediately see the historical prompts and activity for that session.
- When they need the global activity log, the same Live Feed should switch to all-session chronological activity without behaving like a duplicate session list.

## Acceptance Criteria

- [x] Live Feed defaults to the current session when `currentSessionId` is set.
- [x] A visible `このセッション / 全体` scope control switches between current-session and all-session activity.
- [x] Switching the current session causes Live Feed to re-render against the new current session.
- [x] The old category-filter-first workflow is removed from the primary Live Feed header.
- [x] Timeline rows keep the activity/history text readable by reducing non-content columns.
- [x] Targeted Live Feed service/view tests pass.

## Out Of Scope

- Changing the server-side history projection model.
- Adding new activity ingestion sources.
- Making the disabled item action buttons functional.
- Changing session list sorting or active indicators.

---

**Guardrail**: Live Feed scope is a viewer-local UI concern. Activity history remains owned by `LiveFeedService` and session state.
