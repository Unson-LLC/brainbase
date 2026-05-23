---
story_id: story-active-indicator-event-flicker
title: Active Indicator Flicker
status: implemented
horizon: M1
view: runtime
period: 2026-05
architecture_docs:
  - path: docs/session-activity-indicator-lifecycle.md
    status: accepted
  - path: docs/architecture/session-activity-indicator-lifecycle.md
    status: accepted
spec_docs:
  - path: docs/specs/story-active-indicator-event-flicker-spec.md
    status: accepted
source_requirement:
  requirement_title: Active indicator must reflect agent activity consistently across Codex and Claude sessions
---

# Active Indicator Flicker

## Background

Brainbase shows session activity indicators in the session list. The indicator must represent agent activity, not only the selected row or whether a ttyd terminal is connected.

Recent runtime observation on port `31013` showed two different failure modes:

- `/api/sessions/status` reports `running`, but the browser store and DOM remain `idle` until the activity WebSocket or polling hydrates `sessionUi`.
- Some connected Claude sessions never appear in `/api/sessions/status` because the current fallback only recognizes tmux pane-title spinner glyphs. A fixed title such as `Claude Code` is not activity evidence.

## Change

Use explicit activity evidence as the primary source and keep tmux pane titles as fallback only.

## Acceptance Criteria

- [x] On cold page load, `sessionUi.byId[sessionId].hookStatus` is hydrated from `/api/sessions/status` without waiting for terminal/session-content initialization.
- [x] While the activity WebSocket is connected, polling reconciliation still corrects missed or late status snapshots.
- [x] Claude hook activity can resolve the Brainbase session id from the active project/worktree path when `BRAINBASE_SESSION_ID` is not present in the hook environment.
- [x] A connected terminal with no activity evidence remains `idle`; fixed pane titles such as `Claude Code` are not treated as working by themselves.
- [x] Unit tests cover the cold-load reconciliation and Claude hook session-id fallback.

## Implementation Evidence

- `public/modules/session-indicators.js` keeps polling reconciliation active alongside WebSocket updates.
- `.claude/scripts/core/monitoring/brainbase-activity-bridge.ts` resolves session id from `/api/state` by project/worktree path when env/tmux session id is missing.
- `.claude/scripts/run-hook.sh` preserves the original hook cwd as `BRAINBASE_HOOK_ORIGINAL_CWD`.
- `docs/specs/story-active-indicator-event-flicker-spec.md` records the VibePro invariants, contracts, scenarios, anti-patterns, and verification.
- `tests/unit/session-indicators-ws.test.js` covers WebSocket-connected cold-load hydration.
- `.claude/scripts/test/test-activity-bridge-hooks.ts` covers hook activity without `BRAINBASE_SESSION_ID`.

## Out Of Scope

- Treating static pane titles as working state.
- Redesigning the indicator colors or row layout.
- Replacing the full activity reducer with a new snapshot schema in this slice.
