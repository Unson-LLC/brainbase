---
spec_id: SPEC-terminal-history-scrollback
title: Terminal session history remains scrollable
status: active
date: 2026-05-14
story_id: story-terminal-history-scrollback
related_adrs:
  - ADR-terminal-history-scrollback
implementation_files:
  - server/services/terminal-transport-service.js
  - public/modules/core/terminal-transport-client.js
test_files:
  - tests/server/services/terminal-transport-service.test.js
  - tests/unit/terminal-transport-client.test.js
---

# Terminal History Scrollback Spec

## Invariants

- **INV-1**: Desktop xterm transport must not mix a current visible pane snapshot with stale scrollback from an older snapshot.
  - Verification: `tests/server/services/terminal-transport-service.test.js`
- **INV-2**: Polling snapshots that replace terminal content must include enough terminal history to rebuild scrollback coherently.
  - Verification: `tests/server/services/terminal-transport-service.test.js`
- **INV-3**: The client must clear xterm scrollback when applying a history snapshot, and may preserve scrollback only for explicit screen-only updates.
  - Verification: `tests/unit/terminal-transport-client.test.js`

## Contracts

### Contract-1: Terminal polling snapshot

- **input**: active terminal gateway connection in snapshot polling mode.
- **output**: WebSocket `snapshot` message with `screenOnly: false`.
- **preconditions**: caller owns the terminal for the session.
- **postconditions**: xterm receives a history snapshot that can rebuild current screen and scrollback from the same tmux capture.
- **error cases**: if tmux is gone, the connection reports `SESSION_NOT_RUNNING` and closes.

### Contract-2: Screen-only snapshot

- **input**: explicitly screen-only snapshot, used only when preserving scrollback is intentional.
- **output**: WebSocket `snapshot` message with `screenOnly: true`.
- **postconditions**: client updates the current viewport without clearing scrollback.

## Scenarios

### S-1: Polling updates while user later scrolls upward

- **given**: xterm already rendered an initial history snapshot.
- **when**: snapshot polling observes newer terminal output.
- **then**: the next snapshot includes full history and is sent with `screenOnly: false`, so scrolling upward does not cross into stale content.
- **Verification**: `tests/server/services/terminal-transport-service.test.js`

### S-2: Ready snapshot and first polling snapshot are identical

- **given**: the connection has just received the ready-time history snapshot.
- **when**: the first polling cycle captures the same text, color text, and cursor.
- **then**: no duplicate snapshot is sent.
- **Verification**: `tests/server/services/terminal-transport-service.test.js`

## Anti-patterns

- **AP-1**: Do not use visible-pane-only `screenOnly` polling as the steady-state desktop transport.
  - Reason: it updates the current screen while leaving older scrollback from a previous capture.
  - Verification: `tests/server/services/terminal-transport-service.test.js`

## Verification

| Clause | Test | Status |
|---|---|---|
| INV-1 / INV-2 / S-1 / AP-1 | `snapshot-polling transportではscrollback混在を避けるためfull history snapshotを送る` | active |
| S-2 | `ready直後の同一full history snapshotはpollingで二重送信しない` | active |
| INV-3 | `screenOnly snapshot適用時_現在画面だけ消してscrollbackは消さない` | active |
