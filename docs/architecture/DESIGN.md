# Brainbase UI Architecture

## Document Metadata

- Status: Active
- Type: Architecture
- Subject: Brainbase browser UI and terminal surface
- Parent document: [Brainbase Foundation](./brainbase-foundation.md)
- Related documents: [Terminal Runtime Architecture](./terminal-runtime-architecture.md)
- Replaces: ttyd-first browser UI design

## Purpose

Brainbase UI is the browser surface for selecting sessions, viewing context, and interacting with Claude Code or Codex through a terminal.

The UI is a projection. It is not the source of truth for session intent or runtime process health.

## UI Responsibilities

The UI owns:

- session selection
- layout and focus
- viewer identity
- xterm.js host
- local connection display
- explicit user commands such as start, stop, recover, and takeover

The UI does not own:

- live PID truth
- tmux health
- Claude/Codex health
- process recovery policy
- session desired state

## Layout

```text
+----------------+-------------------------------+------------------+
| Sessions       | Terminal                      | Context          |
|                |                               |                  |
| session list   | xterm.js primary surface      | schedule/tasks   |
| runtime badges | degraded/snapshot fallback    | session details  |
+----------------+-------------------------------+------------------+
```

The terminal pane must clearly distinguish:

- `InteractiveReady`: input is enabled
- `SnapshotOnly`: output is visible, input is disabled
- `Recovering`: recovery is running, input is disabled
- `Degraded`: runtime is inconsistent, input is disabled
- `Blocked`: another viewer owns the session

## Terminal Surface

Primary desktop transport:

```text
xterm.js -> Terminal Gateway WebSocket
```

Fallback transport:

```text
ttyd iframe
```

`ttyd` is fallback/debug/mobile compatibility. It is not the primary desktop transport and must not become a separate control plane.

Snapshot display is read-only fallback. Snapshot visibility must never be shown as proof that typing will reach Claude Code or Codex.

## Data Flow

UI read flow:

```text
GET /api/state
GET /api/sessions/:id/runtime
GET /api/sessions/:id/terminal/snapshot
```

Read flows report state only. They must not start or repair runtime processes.

Command flow:

```text
POST /api/sessions/start
POST /api/sessions/:id/terminal/ensure
POST /api/sessions/:id/terminal/recover
POST /api/sessions/:id/terminal/probe-input
POST /api/sessions/:id/terminal/takeover
POST /api/sessions/:id/release-terminal
POST /api/terminal/reconcile
GET /api/health/terminal
```

Command flows are allowed to mutate runtime, but must go through the Session Orchestrator and Process Supervisor.

## State Boundaries

| State | UI treatment |
| --- | --- |
| Session desired state | Read from server, display only |
| Runtime observed state | Read from Runtime Registry projection |
| Terminal connection state | Local and ephemeral |
| Viewer ownership | Local viewer id plus server ownership check |

The UI may cache display data for responsiveness, but it must not make cached runtime observations authoritative.

## Input Rules

The UI may enable keyboard input only when the server reports `InteractiveReady`.

Required conditions:

- Terminal Gateway WebSocket is open.
- Session ownership allows this viewer to type.
- tmux exists.
- Claude Code or Codex is present.
- last input probe passed.

If these conditions are not met, the terminal may remain visible but input must be disabled.

## Error and Degraded States

The UI must avoid hiding intermediate failure behind a normal terminal.

Recommended messages:

- `SnapshotOnly`: "Output is visible. Input is not verified."
- `Recovering`: "Recovering terminal runtime."
- `Degraded`: "Terminal runtime is inconsistent."
- `Blocked`: "This session is active in another viewer."

## Non-Goals

- The UI does not directly manage process trees.
- The UI does not run recovery heuristics locally.
- The UI does not use snapshot freshness as input readiness.
- The UI does not auto-start fallback ttyd on desktop.

## Verification

UI changes touching terminal behavior require a Playwright canary:

1. Open Brainbase.
2. Select a session.
3. Focus xterm.
4. Type a nonce marker.
5. Verify the marker appears in tmux capture.
6. Clear the marker.

Passing visual screenshots alone is not sufficient for terminal changes.
