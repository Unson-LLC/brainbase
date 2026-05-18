---
story_id: str.brainbase.session-context-window-typing
title: Session context bar window typing architecture
status: active
---

# Architecture: Session context bar window typing

## Story

`str.brainbase.session-context-window-typing`

## Decision

Keep the runtime bridge on `window.brainbaseApp` and apply a narrow local `any` cast at the read site in `SessionContextBarView`.

## Rationale

`brainbaseApp` is assigned by the browser runtime after app construction. Defining a broad global Window type for this one read would be larger than the issue; a local cast preserves the current runtime contract and clears JS typecheck.

## Boundaries

- `public/modules/ui/views/session-context-bar-view.js`
- `tests/ui/session-context-bar-view.test.js`

