---
story_id: story-terminal-input-render-stability
title: Terminal input and render stability refactor
source_requirement:
  type: user_report
  description: Codex and Claude Code terminal input is unstable: newline rendering can be missed, typed text can overlap, submit can duplicate the lower terminal area, and typing/deletion can lag.
architecture_docs:
  - path: docs/architecture/terminal-runtime-architecture.md
    status: referenced
    reason: Terminal input must prove the browser-to-PTY path while keeping client-derived UI state separate from runtime state.
related_tasks:
  - task_source: VibePro
    task_ids: [story-terminal-input-render-stability]
status: active
created_at: 2026-05-19
updated_at: 2026-05-23
---

# Terminal input and render stability refactor

## Background

Brainbase renders Claude Code and Codex through xterm. Recent fixes improved individual symptoms, but the client still mixes input capture, readiness probing, local echo, snapshot application, and xterm writes in one transport class. That makes user-visible rendering sensitive to timing between local input feedback, server output, and terminal snapshots.

## Scope

- Make xterm writes deterministic by serializing render operations.
- Keep local echo and pending snapshot reconciliation from racing each other.
- Preserve fast user feedback for Enter, Backspace, and normal typing.
- Keep focus recovery/type-to-focus behavior aligned with the xterm transport key contract.
- Ignore stale deferred session-switch work when a newer terminal switch token exists.
- Add regression tests that fail when the visible input/render contract breaks.

## Acceptance Criteria

- [x] Local echo, submit feedback, server output, and snapshot repaint use one serialized render path.
- [x] Snapshot repaint cannot clear or duplicate pending local input while the user is typing.
- [x] Shift+Enter uses the same repo `S-Enter` prompt-newline key contract in both xterm key handling and type-to-focus recovery.
- [x] Backspace remains immediate for locally echoed ASCII input, and IME commit text remains visible after composition confirmation without duplicate PTY echo rendering.
- [x] Focus reporting/control responses do not enter local echo or normal text batching.
- [x] Browser/server transport treats bare `[I` and `[O` as user text unless they complete a held split focus report; the Codex PTY shim drops bare focus fragments only as outer-terminal response sanitization.
- [x] Deferred session-switch work with an old switch token cannot apply stale terminal focus or render state after the active session changes.
- [x] Browser-to-PTY canary verifies typed text through tmux snapshot capture, not only xterm local buffer state.

## Verification

```bash
vibepro story diagnose . --id story-terminal-input-render-stability --run-graphify
npm test -- tests/unit/terminal-transport-client.test.js tests/server/services/terminal-transport-service.test.js tests/server/services/terminal-io-methods.test.js tests/unit/server-session-manager.test.js && npm test -- tests/unit/terminal-token-status.test.js
npm run typecheck
BRAINBASE_E2E_PORT=31015 BRAINBASE_PORT=31015 PORT=31015 npx playwright test tests/e2e/story-terminal-input-render-stability-canary.spec.ts tests/e2e/story-terminal-input-render-stability.spec.js --project=chromium
```
