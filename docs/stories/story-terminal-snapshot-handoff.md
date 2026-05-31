---
story_id: story-terminal-snapshot-handoff
title: Terminal snapshot->live handoff render stability
source_requirement:
  type: user_report
  description: After switching sessions, the xterm terminal sometimes renders blank or garbled/duplicated content for an interactive TUI (e.g. the Claude Code picker). A first fix (#911) used terminal.reset() and was reverted (#913) because it blanked alt-screen TUIs.
architecture_docs:
  - path: docs/architecture/terminal-runtime-architecture.md
    status: referenced
    reason: One-line change to the post-snapshot handoff inside the existing TerminalTransportClient serialized write path; no new module boundary, data flow, or dependency.
related_tasks:
  - task_source: VibePro
    task_ids: [story-terminal-snapshot-handoff]
status: active
created_at: 2026-05-31
updated_at: 2026-05-31
---

# Terminal snapshot->live handoff render stability

## Background

On a session switch the snapshot preview is written into xterm to establish the visible
frame and cursor; the first live output (tmux attach) then replaces it. The post-snapshot
one-shot used to write `\x1b[2J\x1b[3J\x1b[H` (clear screen + scrollback + home cursor).
An interactive TUI's first live output is a RELATIVE-cursor redraw (e.g. `\x1b[2D\x1b[6B...`),
which can only reconstruct the frame if the frame + cursor are still present. The full clear
wiped them, so the redraw produced a near-blank / garbled screen. `#911`'s `terminal.reset()`
was worse (also exits the alternate screen).

## Scope

- Make the post-snapshot one-shot clear the SCROLLBACK only (`\x1b[3J`), preserving the
  visible frame and cursor for the live relative-cursor redraw.
- Keep the one-shot's original intent (remove ghost rows below from a shorter repaint).
- Disarm the one-shot on the first output message regardless of payload, so an empty first
  output cannot defer the clear onto a later unrelated output.
- Add regression tests, replayed from a REAL captured handoff byte stream, that fail for the
  old `\x1b[2J\x1b[3J\x1b[H` and for `terminal.reset()`.

## Acceptance Criteria

- [x] A session-switch snapshot->live handoff preserves the visible frame for the live app's relative-cursor first redraw: the one-shot writes `\x1b[3J` (scrollback only) and NOT `\x1b[2J\x1b[3J\x1b[H` or `terminal.reset()`.
- [x] A full-repaint app (which emits its own clear) is not ghosted by the scrollback-only one-shot.
- [x] An empty first output disarms the one-shot and the frame still survives the later live redraw.

## Verification

```bash
npx vitest run tests/unit/terminal-snapshot-handoff.test.js
BRAINBASE_E2E_PORT=<port> npx playwright test tests/e2e/story-terminal-snapshot-handoff-xterm.spec.js
```
