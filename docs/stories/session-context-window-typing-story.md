---
story_id: str.brainbase.session-context-window-typing
title: Session context bar window typing
status: active
horizon: M5
view: quality
period: 2026-05
architecture_docs:
  - docs/architecture/session-context-window-typing-architecture.md
spec_docs:
  - docs/specs/session-context-window-typing-spec.md
---

# Story: Session context bar window typing

## Story ID

`str.brainbase.session-context-window-typing`

## Background

`npm run typecheck` failed because `SessionContextBarView` reads the runtime-only `window.brainbaseApp._pendingTerminalSwitch` field from a `// @ts-check` file without a local type escape.

Related architecture: [Session context window typing architecture](../architecture/session-context-window-typing-architecture.md)

Related spec: [Session context window typing spec](../specs/session-context-window-typing-spec.md)

## User Story

As a maintainer, I want the session context bar to keep using the runtime `brainbaseApp` bridge without breaking JS typecheck, so unrelated UI work can verify cleanly.

## Acceptance Criteria

- AC-1: `SessionContextBarView` still checks `_pendingTerminalSwitch` when deciding whether terminal switching is active.
- AC-2: `npm run typecheck` passes.
- AC-3: Existing session context bar tests pass.

