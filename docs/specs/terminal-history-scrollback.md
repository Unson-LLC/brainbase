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
- **INV-4**: In alternate buffer, wheel/touch scroll must be routed to tmux copy-mode scrolling because native xterm scrollback cannot move the TUI viewport.
  - Verification: `tests/unit/terminal-transport-client.test.js`, `tests/server/services/terminal-transport-service.test.js`
- **INV-5**: In normal buffer, wheel/touch scroll must not be captured by tmux scroll routing; native xterm/ttyd scrollback remains the owner of history navigation.
  - Verification: `tests/unit/terminal-transport-client.test.js`, `tests/unit/ttyd-scroll-bridge.test.js`

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

### Contract-3: Alternate-buffer scroll routing

- **input**: wheel/touch scroll while xterm/ttyd is rendering the alternate buffer.
- **output**: tmux `scrollSession(sessionId, direction, steps)` via terminal transport.
- **preconditions**: viewer owns the terminal session.
- **postconditions**: tmux copy-mode scrolls the active pane, and the UI marks the terminal as copy-mode until user interaction exits it.

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

### S-3: Alternate-buffer session receives wheel scroll

- **given**: a desktop xterm or ttyd terminal is in alternate buffer.
- **when**: the user scrolls with a wheel/touch gesture.
- **then**: the gesture is intercepted and sent as tmux scroll, capped to the configured step limit.
- **Verification**: `tests/unit/terminal-transport-client.test.js`, `tests/server/services/terminal-transport-service.test.js`

### S-4: Normal-buffer session receives wheel scroll

- **given**: a desktop xterm or ttyd terminal is in normal buffer with scrollback.
- **when**: the user scrolls with a wheel/touch gesture.
- **then**: the gesture is not intercepted by tmux scroll routing, so native xterm/ttyd scrollback can move.
- **Verification**: `tests/unit/terminal-transport-client.test.js`, `tests/unit/ttyd-scroll-bridge.test.js`

## Anti-patterns

- **AP-1**: Do not use visible-pane-only `screenOnly` polling as the steady-state desktop transport.
  - Reason: it updates the current screen while leaving older scrollback from a previous capture.
  - Verification: `tests/server/services/terminal-transport-service.test.js`
- **AP-2**: Do not intercept all terminal wheel/touch events unconditionally.
  - Reason: normal-buffer sessions must keep native scrollback; routing all scroll to tmux makes sessions with small/no tmux history appear unscrollable.
  - Verification: `tests/unit/terminal-transport-client.test.js`, `tests/unit/ttyd-scroll-bridge.test.js`

## Verification

| Clause | Test | Status |
|---|---|---|
| INV-1 / INV-2 / S-1 / AP-1 | `snapshot-polling transportではscrollback混在を避けるためfull history snapshotを送る` | active |
| S-2 | `ready直後の同一full history snapshotはpollingで二重送信しない` | active |
| INV-3 | `screenOnly snapshot適用時_現在画面だけ消してscrollbackは消さない` | active |
| INV-4 / S-3 | `INV-4/S-3 alternate bufferではwheelをtmux scroll messageへ変換する` | active |
| INV-4 / S-3 | `INV-4/S-3 alternate buffer scroll message はtmux scrollSessionへ送る` | active |
| INV-5 / AP-2 | `INV-5/AP-2 通常bufferではwheelを奪わずnative scrollbackへ任せる` | active |
| INV-5 / AP-2 | `INV-5/AP-2 ttyd wheel handler delegates scroll only in alternate buffer` | active |
