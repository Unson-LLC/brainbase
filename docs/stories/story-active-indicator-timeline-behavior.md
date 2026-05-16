---
story_id: story-active-indicator-timeline-behavior
title: Active indicator timeline behavior
source_requirement:
  requirement_title: Active indicator must reflect work activity, not selected row state
architecture_docs:
  - path: docs/architecture/session-activity-indicator-lifecycle.md
    status: accepted
reason: Existing SessionView and session activity state boundaries are unchanged; this story adds spec/test coverage for current behavior only.
related_tasks: []
status: active
created_at: 2026-05-16
updated_at: 2026-05-16
---

# Active indicator timeline behavior

## Background

The session list has separate concepts for the selected/current session and for live work activity. A selected row can be old or idle, while another session can be actively running through hook status. The active indicator must follow the activity state, not the visual row selection.

## Current State

- Timeline ordering is driven by derived `sessionUi` state.
- Runtime tests can exercise startup and switching paths.
- Without an explicit contract, regressions can re-couple activity indicators to row selection or external websocket startup side effects.

## Change

### Who

- Brainbase users and operators monitoring multiple live sessions.

### What

- Preserve a spec-backed contract that active timeline ordering is derived from hook status.
- Add deterministic view coverage for an actively thinking session being promoted above an idle session.
- Isolate runtime switching tests from real activity websocket/bootstrap side effects.

### Why

- The UI must make active work visible even when `currentSessionId` or row selection points elsewhere.
- Tests must reproduce this behavior without depending on live local infrastructure.

## Acceptance Criteria

- [x] A session with active hook status is sorted above an idle session in timeline view.
- [x] The active work ordering contract is documented in `docs/specs/story-active-indicator-timeline-behavior-spec.md`.
- [x] Runtime integration tests mock activity websocket startup and unrelated bootstrap-only services.
- [x] The targeted session activity and UI test suite passes.

## Out Of Scope

- Changing the active indicator rendering design.
- Changing server activity state derivation in this PR.
- Adding new browser-only Playwright coverage for unchanged browser behavior.

---

**Guardrail**: This story describes value and acceptance criteria only; implementation details live in the spec and tests.
