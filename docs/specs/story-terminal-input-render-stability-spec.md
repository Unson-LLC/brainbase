# Spec: Terminal input and render stability

## Invariants

- INV-1: xterm rendering must pass through a single serialized writer for local echo, submit feedback, server output, and snapshot repaint.
- INV-2: A snapshot received while local echo is unconfirmed must not repaint the terminal unless the snapshot contains the pending local echo or the echo timeout has expired.
- INV-3: Submit feedback may clear local echo state only through the same render ordering path as the submit input.
- INV-4: Focus report sequences (`ESC [ I`, `ESC [ O`) and terminal OSC color responses must not be locally echoed as user input.
- INV-5: Backspace may optimistically erase only locally echoed single-cell ASCII input; IME/non-ASCII input must wait for PTY output.
- INV-6: Shift+Enter must use the repo's `S-Enter` prompt-newline key consistently across xterm custom key handling and type-to-focus recovery.

## Contracts

- CON-1: `TerminalTransportClient.sendText()` classifies input before readiness probing and before any local echo.
- CON-2: `TerminalTransportClient._writeToTerminal()` is the single enqueue boundary for input/output/snapshot handlers; those handlers must not call `terminal.write()` or `terminal.reset()` directly.
- CON-3: Snapshot repaint is an atomic render operation: capture viewport, clear screen, write snapshot text, then restore viewport.
- CON-4: Type-to-focus recovery sends at most one explicit key for the initiating browser keydown event and prevents the browser event only after ownership of that send path is established.

## Scenarios

- S-1: User types `abc`, immediately presses Backspace, and server output has not returned. The visible terminal shows `ab`, and one `DEL` input is sent.
- S-2: User types text while an input probe is pending. Local feedback appears immediately, but queued dispatch cannot be reordered ahead of earlier input.
- S-3: A snapshot arrives while pending local echo is `draft`. The snapshot is deferred when it does not contain `draft`; it is discarded after server output confirms `draft`.
- S-4: User presses Shift+Enter while xterm is not focused but terminal transport is active. The recovery path sends the same `S-Enter` prompt-newline key as xterm custom key handling.
- S-5: xterm emits `abc ESC[I def`. Only `abcdef` is eligible for local echo; the focus report is sent or ignored as control input, never drawn.
- S-6: Deferred session-switch work that carries an old switch token must be ignored so a stale terminal focus/render update cannot apply after the user has switched sessions.

## Anti-patterns

- AP-1: Calling `terminal.write()` or `terminal.reset()` directly from multiple concerns and relying on callback timing for ordering.
- AP-2: Using raw substring matching as the only guard between pending local echo and snapshot repaint.
- AP-3: Mapping the same physical key to different transport keys depending on focus state.
- AP-4: Treating browser focus loss as a WebSocket failure without checking xterm DOM focus.

## Verification

- V-1: `npm test -- tests/unit/terminal-transport-client.test.js`
- V-2: `vibepro story diagnose . --id story-terminal-input-render-stability --run-graphify`
- V-3: `vibepro pr prepare . --base origin/develop --story-id story-terminal-input-render-stability`
