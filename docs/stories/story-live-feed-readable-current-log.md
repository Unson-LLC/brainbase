---
story_id: story-live-feed-readable-current-log
title: Live Feed readable current session log
source_requirement:
  requirement_title: Live Feed current session display should prioritize readable prompt history
architecture_docs:
  - path: docs/architecture/live-feed-readable-current-log-architecture.md
    status: accepted
spec_docs:
  - path: docs/specs/live-feed-readable-current-log-spec.md
    status: active
reason: The current Live Feed achieves current/all history scope, but the current-session view still spends space on repeated session metadata and disabled row actions.
status: active
created_at: 2026-05-25
updated_at: 2026-05-25
---

# Live Feed readable current session log

## Background

The Live Feed now defaults to the current session and can switch to all sessions. In the current-session view, however, every row still shows repeated session id metadata, duplicate `ユーザー入力` labels, disabled action icons, and scope buttons that can wrap in narrow drawer widths. That makes the surface feel noisier than a prompt/activity log.

## Change

- Keep the two-scope model: `このセッション` and `全体`.
- Make scope buttons stable and non-wrapping in the info drawer.
- Treat current-session scope as a log of that session: prioritize timestamp, event type, and text.
- Hide repeated session id metadata when already scoped to the current session.
- Avoid duplicate source/status text when both represent the same concept.
- Remove disabled row action buttons from the visual row so text receives the width.
- Keep all-session scope able to show session identity per row.

## Acceptance Criteria

- [x] Scope buttons render horizontally without splitting `このセッション` into vertical text at 430px drawer width.
- [x] Current-session rows do not show repeated `session-*` metadata.
- [x] Current-session prompt rows do not show duplicate `ユーザー入力` source/status labels.
- [x] Row action icons are not rendered when the actions are disabled/non-functional.
- [x] All-session scope still shows enough session identity to distinguish rows.
- [x] Targeted Live Feed unit and E2E tests pass.

## Out Of Scope

- Adding functional row actions.
- Changing history ingestion or ordering.
- Changing session list sorting or active indicators.
