---
spec_id: story-terminal-open-scroll-bottom-spec
title: Terminal open scroll bottom specification
story_ref: story-terminal-open-scroll-bottom
source_story: docs/stories/story-terminal-open-scroll-bottom.md
source_architecture: docs/brainbase-capabilities/capabilities/terminal.transport.yml
status: active
created_at: 2026-05-21
updated_at: 2026-05-27
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
- INV-7: Deferred desktop xterm display for a newly opened session must not reveal xterm until the first reset/full snapshot write has completed, unless a bounded timeout fallback is reached.
- INV-8: WebSocket `ready` means transport-live, not visual-ready, when `waitForInitialResetSnapshot` is requested.

## Contracts

- C-1: `_applySnapshot(text, { resetTerminal: true })` uses an explicit pinned-bottom viewport state instead of restoring a pre-write top/old viewport.
- C-2: `_restoreViewportAfterTerminalWrite()` keeps the existing one-shot pinned-bottom restore behavior and reserves next-frame restore for scrolled-up viewport preservation.
- C-3: `_applySnapshot(text, { resetTerminal: false })` keeps the existing capture-and-restore behavior.
- C-4: `_renderTerminalSnapshotPanel(..., { pinToBottom: true })` treats the render as a latest-output operation and scrolls the panel content to the bottom after applying the snapshot text.
- C-5: Session switch callers pass `pinToBottom: true` only for the immediate cached/fresh snapshot display used to open the selected session.
- C-6: `TerminalTransportClient.connect(sessionId, { waitForInitialResetSnapshot: true })` resolves only after both `ready` and the first reset snapshot write callback have happened.
- C-7: `TerminalTransportClient.connect()` returns `{ mode: "live", initialResetSnapshot: "timeout" }` when `ready` arrives but the first reset snapshot does not arrive before the bounded fallback.
- C-8: `_connectXtermTransport(..., { deferDisplay: true })` requests initial reset snapshot waiting before calling `_showXtermTransport()`.

## Scenarios

- S-1: Given xterm is currently at the top of a long buffer, when an open/reconnect reset snapshot is applied, then `scrollToBottom()` is called and the final viewport is latest output.
- S-2: Given the user is reading older scrollback, when a normal non-reset snapshot refresh is applied, then the previous distance from the bottom is restored.
- S-3: Given a session switch forces the next snapshot, when that snapshot is applied, then the viewport is pinned to bottom through the existing forced snapshot path.
- S-4: Given the previous session's snapshot panel was top-scrolled, when a Claude Code session is opened with cached or fresh snapshot panel content, then the panel opens at the latest output.
- S-5: Given WebSocket `ready` arrives before the first reset snapshot, when desktop xterm display is deferred, then `connect()` remains pending and xterm stays hidden until the reset snapshot write callback completes.
- S-6: Given WebSocket `ready` arrives but no initial reset snapshot arrives, when the wait timeout expires, then `connect()` resolves live with timeout metadata so the UI can recover instead of remaining hidden forever.

## Anti-patterns

- AP-1: Capturing the pre-reset viewport and restoring it after writing a full open snapshot.
- AP-2: Calling `terminal.write()` or `terminal.reset()` outside the serialized terminal write queue.
- AP-3: Forcing bottom on every snapshot and preventing users from reading older scrollback.
- AP-4: Reusing a previous session's snapshot panel `scrollTop` as the initial viewport for a newly selected session.
- AP-5: Treating WebSocket `ready` as permission to reveal deferred xterm before the first reset/full snapshot has been written.

## Verification

- Unit: `npm run test:run -- tests/unit/terminal-transport-client.test.js`
- Integration: `npm run test:run -- tests/ui/integration/app-switch-session-runtime.test.js tests/unit/terminal-transport-client.test.js`
- E2E: `BRAINBASE_E2E_PORT=31017 BRAINBASE_PORT=31017 PORT=31017 npm run test:e2e -- tests/e2e/story-terminal-open-scroll-bottom-xterm.spec.ts --project=chromium`
- Typecheck: `npm run typecheck`
- VibePro: `vibepro story diagnose . --id story-terminal-open-scroll-bottom --run-graphify`
