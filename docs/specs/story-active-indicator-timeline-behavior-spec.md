---
spec_id: SPEC-active-indicator-timeline-behavior
title: Active Indicator Timeline Behavior
status: active
date: 2026-05-16
story_id: story-active-indicator-timeline-behavior
related_adrs: []
related_specs:
  - SPEC-story-session-workspace-generation-rotation
implementation_files:
  - public/modules/ui/views/session-view.js
  - public/modules/core/session-activity-state.js
test_files:
  - tests/ui/views/session-view.test.js
  - tests/ui/integration/app-switch-session-runtime.test.js
---

# Active Indicator Timeline Behavior

## Invariants

- **INV-1**: Timeline view must derive active indicator ordering from `sessionUi.byId[sessionId].hookStatus`, not from row selection or list position.
  - Verification: `tests/ui/views/session-view.test.js`
- **INV-2**: App startup tests must not open a real activity websocket or unrelated bootstrap side effects when verifying session switching.
  - Verification: `tests/ui/integration/app-switch-session-runtime.test.js`

## Contracts

### Contract-1: Timeline activity ordering

- **input**: A session list and `sessionUi.byId` hook status snapshots.
- **output**: Non-archived sessions sorted so active hook statuses (`running`, `starting`, `waiting`, or equivalent working UI state) are in the timeline attention group.
- **preconditions**: `ui.sessionListView` is `timeline`.
- **postconditions**: A session with active work evidence is rendered before an otherwise newer or idle session.
- **error cases**: Missing `sessionUi` for a session falls back to normal timestamp ordering.

### Contract-2: Runtime integration test isolation

- **input**: `createApp().start()` execution inside Vitest.
- **output**: Runtime switching behavior can be asserted without real websocket, auth, plugin, or port registration side effects.
- **preconditions**: `session-indicators.js` and startup-only services are mocked in the test harness.
- **postconditions**: Startup tests remain deterministic and do not time out on external activity infrastructure.
- **error cases**: If the real activity websocket is opened, tests can hang or observe unrelated state changes.

## Scenarios

### S-1: Active thinking session is sorted above idle timeline sessions

- **given**: Two active sessions in timeline view, where `session-1` has a working hook status with `activeTurnCount: 1` and `session-2` has no hook status.
- **when**: The session view renders.
- **then**: `session-1` appears before `session-2`.
- **Verification**: `tests/ui/views/session-view.test.js`

### S-2: Startup tests do not depend on live activity websocket

- **given**: App runtime integration tests instantiate `createApp()`.
- **when**: `app.start()` is exercised by switching/runtime tests.
- **then**: Activity websocket startup and unrelated bootstrap services are mocked so the test remains scoped to session runtime behavior.
- **Verification**: `tests/ui/integration/app-switch-session-runtime.test.js`

## Anti-patterns

- **AP-1**: Treating `.active` row styling or current session selection as the source of truth for active work.
  - **reason**: Selection and work activity are independent states; coupling them recreates the stale active indicator bug.
  - **Verification**: `tests/ui/views/session-view.test.js`
- **AP-2**: Letting UI integration tests contact real websocket/auth/plugin services for session switching assertions.
  - **reason**: External bootstrap side effects make activity indicator regressions hard to reproduce deterministically.
  - **Verification**: `tests/ui/integration/app-switch-session-runtime.test.js`

## Verification

| Clause | Test | Status |
|---|---|---|
| INV-1 | `tests/ui/views/session-view.test.js` `S-1: should sort active thinking sessions to the top in timeline view` | pass |
| INV-2 | `tests/ui/integration/app-switch-session-runtime.test.js` startup mocks | pass |
| S-1 | `tests/ui/views/session-view.test.js` `S-1: should sort active thinking sessions to the top in timeline view` | pass |
| S-2 | `tests/ui/integration/app-switch-session-runtime.test.js` `start後にcurrent sessionをxtermへ昇格する` and related startup tests | pass |
| AP-1 | `tests/ui/views/session-view.test.js` `S-1: should sort active thinking sessions to the top in timeline view` | pass |
| AP-2 | `tests/ui/integration/app-switch-session-runtime.test.js` startup mocks | pass |
