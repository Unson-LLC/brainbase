# Spec: Terminal snapshot->live handoff render stability

## Invariants

- INV-1: The post-snapshot session-switch one-shot must clear the SCROLLBACK only (`\x1b[3J`). It must NOT clear the visible screen or home the cursor (`\x1b[2J` / `\x1b[H`) and must NOT call `terminal.reset()`, because the live app's first output is a relative-cursor redraw that depends on the snapshot frame + cursor still being present.
- INV-2: The one-shot is armed only by a session-switch reset snapshot (`_liveResetPendingAfterSnapshot`) and is disarmed on the FIRST output message regardless of whether it carries data; `\x1b[3J` is benign on an empty repaint.
- INV-3: A full-repaint live output (which emits its own `\x1b[2J`/`\x1b[H`) must render with no ghost rows from the preserved frame.

## Contracts

- CON-1: `TerminalTransportClient` `case 'output'` handler runs the one-shot through the existing serialized `_writeToTerminal()` path; it does not call `terminal.write()` / `terminal.reset()` directly for the one-shot.
- CON-2: The one-shot fires exactly once per session-switch handoff.

## Scenarios

- S-1: Switch to a session running an interactive TUI. Snapshot frame is drawn, the one-shot writes `\x1b[3J`, the live relative-cursor redraw lands on the preserved frame; the screen is not blank/garbled.
- S-2: The first live output after the snapshot is empty. The one-shot disarms, and the subsequent real relative redraw still lands on the preserved frame.
- S-3: The live app does a full repaint (its own `\x1b[2J\x1b[H`). The result shows only the repaint, no ghost rows.

## Anti-patterns

- AP-1: Clearing the visible screen + homing the cursor (`\x1b[2J\x1b[3J\x1b[H`) before a relative-cursor redraw.
- AP-2: Using `terminal.reset()` on the handoff (exits the alternate screen -> blank).
- AP-3: Guarding the one-shot disarm on `outputData` being non-empty (stale-flag leak onto a later output).

## Verification

```bash
npx vitest run tests/unit/terminal-snapshot-handoff.test.js
BRAINBASE_E2E_PORT=<port> npx playwright test tests/e2e/story-terminal-snapshot-handoff-xterm.spec.js
```
