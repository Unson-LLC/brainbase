---
spec_id: story-terminal-open-scroll-bottom-spec
title: Terminal open scroll bottom specification
story_ref: story-terminal-open-scroll-bottom
source_story: docs/stories/story-terminal-open-scroll-bottom.md
source_architecture: docs/brainbase-capabilities/capabilities/terminal.transport.yml
status: active
created_at: 2026-05-21
updated_at: 2026-05-23
---

# Terminal open scroll bottom specification

## Scope

- `public/modules/core/terminal-transport-client.js`
- `public/modules/app/terminal-input-ux-mixin.js`
- `public/modules/app/session-management-mixin.js`
- `tests/unit/terminal-transport-client.test.js`
- `tests/ui/integration/app-switch-session-runtime.test.js`

## Invariants

- INV-1: Reset/full snapshots used for terminal open, session switch, reconnect, or forced repaint must pin the xterm viewport to the latest output after the write completes.
- INV-2: Non-reset snapshots must preserve the user's distance from the bottom when the user has scrolled up.
- INV-3: Snapshot panel renders caused by session open or session switch must pin to the latest output, regardless of the previous session panel scroll position.
- INV-4: Normal snapshot panel refreshes must preserve sticky-bottom behavior and must not force the viewport down when the user intentionally scrolled up.
- INV-5: Xterm snapshot rendering must continue to pass through `TerminalTransportClient._writeToTerminal()`.
- INV-6: The fix must not change the tmux snapshot API, scrollback size, or terminal history content.

## Contracts

- C-1: `_applySnapshot(text, { resetTerminal: true })` uses an explicit pinned-bottom viewport state instead of restoring a pre-write top/old viewport.
- C-2: `_restoreViewportAfterTerminalWrite()` keeps the existing one-shot pinned-bottom restore behavior and reserves next-frame restore for scrolled-up viewport preservation.
- C-3: `_applySnapshot(text, { resetTerminal: false })` keeps the existing capture-and-restore behavior.
- C-4: `_renderTerminalSnapshotPanel(..., { pinToBottom: true })` treats the render as a latest-output operation and scrolls the panel content to the bottom after applying the snapshot text.
- C-5: Session switch callers pass `pinToBottom: true` only for the immediate cached/fresh snapshot display used to open the selected session.

## Scenarios

- S-1: Given xterm is currently at the top of a long buffer, when an open/reconnect reset snapshot is applied, then `scrollToBottom()` is called and the final viewport is latest output.
- S-2: Given the user is reading older scrollback, when a normal non-reset snapshot refresh is applied, then the previous distance from the bottom is restored.
- S-3: Given a session switch forces the next snapshot, when that snapshot is applied, then the viewport is pinned to bottom through the existing forced snapshot path.
- S-4: Given the previous session's snapshot panel was top-scrolled, when a Claude Code session is opened with cached or fresh snapshot panel content, then the panel opens at the latest output.

## Anti-patterns

- AP-1: Capturing the pre-reset viewport and restoring it after writing a full open snapshot.
- AP-2: Calling `terminal.write()` or `terminal.reset()` outside the serialized terminal write queue.
- AP-3: Forcing bottom on every snapshot and preventing users from reading older scrollback.
- AP-4: Reusing a previous session's snapshot panel `scrollTop` as the initial viewport for a newly selected session.

## Verification

- Unit: `npm run test:run -- tests/unit/terminal-transport-client.test.js`
- Integration: `npm run test:run -- tests/ui/integration/app-switch-session-runtime.test.js tests/unit/terminal-transport-client.test.js`
- E2E: `BRAINBASE_E2E_PORT=31014 BRAINBASE_PORT=31014 PORT=31014 npx playwright test tests/e2e/story-terminal-open-scroll-bottom-xterm.spec.ts --project=chromium`
- Typecheck: `npm run typecheck`
- VibePro: `vibepro story diagnose . --id story-terminal-open-scroll-bottom --run-graphify`
