# Terminal Runtime Architecture

## Document Metadata

- Status: Active
- Type: Architecture
- Subject: Brainbase terminal runtime for Claude Code and Codex
- Parent document: [Brainbase Foundation](./brainbase-foundation.md)
- Related documents: [UI Design](./DESIGN.md), [Session Runtime Stability Baseline](../internal/session-runtime-stability-2026-04-02.md)
- Replaces: ad hoc ttyd-first runtime model

## Purpose

Brainbase exposes Claude Code and Codex as an interactive browser terminal. This document defines the stable architecture for that path.

The goal is not merely to show terminal output. The system must be able to prove that input can travel from the browser to the AI CLI and that output can return to the browser.

## Core Principle

The terminal runtime is split into three kinds of state.

| State | Meaning | Owner | Persistence |
| --- | --- | --- | --- |
| Desired state | What should exist | Session Orchestrator | Persistent |
| Observed state | What actually exists | Runtime Registry | Runtime ledger |
| Derived UI state | What the user sees | Client / Terminal Gateway | Ephemeral |

These states must not be collapsed into one field or one file.

`state.json` must not be treated as a live process registry. It may reference session intent, engine, worktree, and resume identity. It must not be the authority for live PID health.

## Target Layers

The user-facing terminal is composed of seven layers.

```text
User
  -> Client Layer
  -> Terminal Gateway Layer
  -> Session Orchestrator Layer
  -> Runtime Registry Layer
  -> Process Supervisor Layer
  -> PTY Runtime Layer
  -> Claude Code / Codex

Observability & Recovery observes all layers and reconciles drift.
```

### 1. Client Layer

Responsibilities:

- Render Brainbase UI.
- Select the current session.
- Host xterm.js.
- Hold viewer-local UI state such as focus, selected session, and transient connection status.

Non-responsibilities:

- Persist live process state.
- Decide whether tmux, ttyd, Claude Code, or Codex is healthy.
- Start runtime processes as a side effect of display.

### 2. Terminal Gateway Layer

Responsibilities:

- Own the browser terminal WebSocket.
- Receive text/key input from xterm.js.
- Send input to the PTY runtime through a single server-side input path.
- Stream terminal output.
- Provide read-only snapshot fallback.
- Enforce terminal ownership semantics consistently.
- Run or report input probes.

The primary input path is:

```text
Browser xterm
  -> Terminal Gateway WebSocket
  -> terminal IO service
  -> tmux send-keys / paste-buffer
  -> Claude Code or Codex TUI
```

`ttyd` is not the primary desktop transport. It is a fallback/debug/mobile compatibility path only.

### 3. Session Orchestrator Layer

Responsibilities:

- Own session intent.
- Transition sessions through the runtime state machine.
- Decide when a session should be active, paused, recovering, degraded, archived, or dead.
- Expose explicit commands for start, stop, recover, and archive.

Read endpoints must not perform hidden recovery. A `GET` request may report state, but it must not create new ttyd processes, restart tmux, or claim terminal ownership as a side effect.

### 4. Runtime Registry Layer

Responsibilities:

- Record observed runtime facts.
- Track the active server generation.
- Track tmux session existence.
- Track terminal gateway connection state.
- Track ttyd pid/port only when ttyd fallback is actually required.
- Track Claude Code / Codex process identity and heartbeat.
- Track last input probe result.

Runtime registry entries are observations, not desired state. Stale observations are cleared or replaced by the reconciler.

### 5. Process Supervisor Layer

Responsibilities:

- Ensure exactly one canonical Brainbase server controls runtime.
- Start `server.js` only through `start.js`.
- Refuse direct `server.js` execution on the canonical port unless explicitly allowed for test/dev.
- Assign a server generation ID.
- Kill or quarantine stale servers and stale ttyd processes from older generations.
- Run the runtime reconciler.

Invariant:

```text
There must be one canonical control plane for the canonical Brainbase runtime.
```

Multiple servers may not concurrently mutate the same runtime registry, `state.json`, tmux sessions, or ttyd processes.

### 6. PTY Runtime Layer

Responsibilities:

- Host the actual terminal process tree.
- Keep long-running AI work alive independently of the browser tab.
- Run tmux.
- Start Claude Code or Codex through the session runtime scripts.
- Preserve resume continuity.
- Contain child commands and MCP processes.

The PTY runtime is allowed to be long-lived. It is not allowed to be unobserved.

### 7. Observability & Recovery Layer

Responsibilities:

- Observe every layer.
- Detect drift between desired state and observed state.
- Run lightweight health checks continuously.
- Run full input probes as canaries.
- Record structured recovery actions.
- Reconcile toward invariants.

Recovery must converge the system. It must not blindly add replacement processes while stale ones continue running.

## Runtime State Machine

The terminal runtime state machine is:

| State | Meaning | User input |
| --- | --- | --- |
| `NoRuntime` | No tmux/CLI runtime exists | Disabled |
| `TmuxReady` | tmux exists, CLI readiness unknown | Disabled |
| `CliStarting` | Claude/Codex is being launched or resumed | Disabled |
| `InteractiveReady` | WebSocket, tmux, CLI, and input probe are healthy | Enabled |
| `SnapshotOnly` | Output can be captured, input is not proven | Disabled |
| `Recovering` | Recovery is in progress | Disabled |
| `Degraded` | Runtime exists but one or more invariants failed | Disabled |
| `Dead` | Required runtime process is gone | Disabled |
| `Archived` | Session is intentionally inactive | Disabled |

Only `InteractiveReady` may be shown as input-capable.

## Health Model

Health is layered.

| Check | What it proves | What it does not prove |
| --- | --- | --- |
| Server health | HTTP server responds | Terminal is usable |
| WebSocket open | Browser can connect to Terminal Gateway | Input reaches CLI |
| tmux exists | PTY container exists | CLI is responsive |
| snapshot capture | Screen can be read | Input works |
| heartbeat fresh | Claude/Codex hook reported recently | Prompt accepts input |
| input probe passed | Browser-to-CLI input path works | Future child command will finish |

The UI must not present a session as input-capable unless the input path is proven.

## Input Probe

The input probe verifies the actual path:

```text
browser -> xterm -> WebSocket -> Terminal Gateway -> tmux -> Claude/Codex TUI
```

Rules:

- Probe only when the CLI is idle or waiting for input.
- Use a nonce marker.
- Confirm the nonce through tmux capture.
- Clear the probe text after confirmation.
- Record probe result in the Runtime Registry.
- Do not claim terminal ownership from the user's active viewer.

The probe may be implemented in two levels:

1. Server-level probe: Terminal Gateway sends input to tmux and verifies capture.
2. Browser-level canary: Playwright opens Brainbase, focuses xterm, types text, verifies tmux capture, and clears the input.

The browser-level canary is the strongest signal and should be part of local smoke verification for terminal changes.

## Reconciler

The reconciler compares desired and observed state.

Inputs:

- Session desired state.
- Runtime registry.
- Process table.
- tmux sessions and pane PIDs.
- WebSocket connections.
- ttyd processes.
- Claude/Codex process tree.
- Heartbeat and input probe results.

Required invariants:

- One canonical server generation controls the runtime.
- One active tmux session per active Brainbase session.
- At most one primary terminal gateway connection per session.
- At most one ttyd fallback process per session, and only when fallback is required.
- No stale server may mutate canonical runtime state.
- No dead PID remains authoritative.
- `InteractiveReady` requires a passing input probe.

Recovery order:

1. Observe and classify.
2. Remove stale duplicate processes.
3. Update observed registry.
4. Retry lightweight gateway connection.
5. Restart only the Claude/Codex TUI when the PTY is healthy but the CLI is wedged.
6. Resume the latest known Claude/Codex conversation.
7. Mark `Degraded` if automated recovery cannot prove interactivity.

## Transport Policy

Primary desktop transport:

```text
xterm.js + Brainbase Terminal Gateway WebSocket
```

Fallback transport:

```text
ttyd iframe
```

Fallback constraints:

- It must not be auto-restored for desktop sessions unless explicitly requested.
- A persisted `ttydProcess` marker on an active session is the explicit request to
  keep the fallback transport recoverable across boot restore, watchdog, and
  operator recovery. If tmux is still alive but the matching ttyd process is not
  observed, reconnect only ttyd and preserve the tmux/Codex process.
- It must be reconciled by generation.
- It must not hold independent ownership semantics.
- It must not become a second control plane.

Snapshot policy:

- Snapshot is read-only fallback.
- Snapshot may keep the previous screen visible during reconnect.
- Snapshot must not imply input availability.

## Ownership Policy

Terminal ownership is a Terminal Gateway concern.

Rules:

- xterm WebSocket and ttyd fallback use the same ownership semantics.
- Diagnostics and snapshots must not steal ownership.
- Browser unload or WebSocket close releases ownership when safe.
- Takeover must be explicit or governed by one documented auto-takeover rule.

## API Policy

Read APIs:

- Report current desired, observed, and derived state.
- Do not start or kill runtime processes.
- Do not claim ownership.

Command APIs:

- Start runtime.
- Stop runtime.
- Recover runtime.
- Force takeover.
- Run input probe.
- Reconcile runtime.

This separation prevents page reloads and status polling from mutating runtime state.

## Logging Policy

Runtime events should be structured and include:

- server generation
- session ID
- event type
- process PID/PGID when relevant
- previous state
- next state
- recovery action ID
- probe nonce/result when relevant

Required event types:

- server start/stop
- direct server launch rejection
- reconciler start/finish
- duplicate process detected
- process killed
- tmux created/died
- Claude/Codex launched/resumed/restarted
- WebSocket opened/closed
- input probe passed/failed
- state transition

## Testing Requirements

Any terminal/runtime change must include verification at the right layer.

Minimum:

- Unit tests for runtime state transitions.
- Unit tests for ownership semantics.
- Unit tests for reconciler duplicate-process decisions.
- Integration test for server-to-tmux input.
- Playwright smoke test for browser-to-tmux input.

The Playwright smoke test must:

1. Open Brainbase.
2. Select a test session.
3. Focus xterm.
4. Type a nonce marker.
5. Verify the nonce through tmux capture.
6. Clear the input.

## Anti-Patterns

Do not:

- Treat `tmux exists` as terminal health.
- Treat snapshot visibility as input readiness.
- Store live PID truth in `state.json`.
- Start ttyd from a read endpoint.
- Run multiple canonical servers against the same runtime.
- Let diagnostics claim terminal ownership.
- Restart ttyd when Claude/Codex is the wedged process.
- Hide `Degraded` as a normal connected state.

## Migration Path

Implemented runtime endpoints:

- `GET /api/sessions/:id/runtime` is read-only.
- `GET /api/sessions/:id/terminal/snapshot` is read-only and does not claim ownership.
- `POST /api/sessions/:id/terminal/probe-input` verifies real input delivery.
- `POST /api/sessions/:id/terminal/recover` runs explicit session recovery through the reconciler.
- `POST /api/sessions/:id/terminal/takeover` explicitly transfers input ownership.
- `POST /api/terminal/reconcile` compares desired and observed runtime state.
- `GET /api/health/terminal` reports terminal runtime health.

Remaining hardening path:

1. Extend runtime process observation with CLI process-group details.
2. Add a Playwright input canary that asserts text entry after reload.
3. Make UI display `InteractiveReady`, `SnapshotOnly`, `Recovering`, and `Degraded` distinctly in every terminal presentation.
