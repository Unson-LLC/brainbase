---
story_id: str.brainbase.session-context-window-typing
title: Session context bar window typing spec
status: active
---

# SPEC: Session context bar window typing

## Story

`str.brainbase.session-context-window-typing`

## Invariants

- INV-1: `_isTerminalSwitchActive()` must keep reading `_pendingTerminalSwitch` from `window.brainbaseApp`.
- INV-2: The runtime-only `brainbaseApp` property must not break `npm run typecheck`.

## Verification

- `tests/ui/session-context-bar-view.test.js`
- `npm run typecheck`

