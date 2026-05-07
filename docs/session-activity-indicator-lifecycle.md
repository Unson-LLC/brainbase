# Session Activity Indicator Lifecycle

## Purpose

This document is the source of truth for Brainbase session activity state.

The active indicator must not be designed as a color toggle. It is a lifecycle state that is reduced on the server, transported through API/WebSocket, rendered by the client, and used by timeline sorting under the same contract.

VibePro story: `story-active-indicator-ssot-design`

Graphify evidence:

- command: `vibepro graph . --run-graphify`
- artifact: `.vibepro/graphify/graph.json`
- relevant communities observed: server activity reducer, status API, WebSocket status push, client session UI state, session indicators, timeline sort, Codex PTY fallback reporter

## Root Cause

The previous design allowed several independent state producers:

- server persisted `hookStatus.status`
- server derived `isWorking` and `isDone`
- server synthesized tmux pane-title spinner status
- client normalized `status` back into `isWorking` and `isDone`
- client locally cleared `isDone`
- `liveActivity.statusTone` also influenced display
- timeline sort derived its own priority from client state

Because these producers were not ordered by confidence, weak fallback evidence could override explicit completion, and local read state could be overwritten by polling or WebSocket updates. This is why the indicator flickered between blue and green.

## Canonical State

The server owns the only canonical state: `SessionActivitySnapshot`.

```ts
type SessionActivityState =
  | 'idle'
  | 'starting'
  | 'running'
  | 'waiting'
  | 'done-unread';

type EvidenceConfidence =
  | 'explicit'
  | 'derived'
  | 'fallback';

type SessionActivitySnapshot = {
  sessionId: string;
  state: SessionActivityState;
  confidence: EvidenceConfidence;
  activeTurns: Array<{
    id: string;
    source: 'brainbase-input' | 'codex-hook' | 'claude-hook' | 'codex-pty';
    startedAt: number;
    lastSeenAt: number;
  }>;
  terminalDoneAt: number;
  readAt: number;
  lastExplicitWorkingAt: number;
  lastFallbackAt: number;
  lastEvent: {
    source: string;
    type: string;
    lifecycle: string;
    turnId?: string;
    reportedAt: number;
    receivedAt: number;
  } | null;
  liveActivity: {
    activityKind?: string | null;
    taskBrief?: string | null;
    assistantSnippet?: string | null;
    currentStep?: string | null;
    latestEvidence?: string | null;
    statusTone?: string | null;
    updatedAt?: number;
    assistantSnippetUpdatedAt?: number;
  } | null;
};
```

Compatibility fields may be emitted for old client code, but they must be derived from `snapshot.state` only:

```ts
isWorking = state === 'starting' || state === 'running' || state === 'waiting';
isDone = state === 'done-unread';
activeTurnCount = activeTurns.length;
```

The client must not recreate canonical truth from those fields.

## Display Mapping

| State | Indicator | Meaning |
| --- | --- | --- |
| `idle` | none | No active or unread activity, or completion has been read |
| `starting` | blue | Prompt was submitted or a strong start signal was received, but no explicit turn is open yet |
| `running` | blue | One or more active turns are open |
| `waiting` | orange | The agent is waiting for user input or selection |
| `done-unread` | green | The agent has stopped and there is an unread completion |

Colors are views of state. They are not state.

## Evidence Classes

### Explicit Evidence

Explicit evidence may transition canonical state:

- `brainbase/input-submit`
- `codex/hook/PreToolUse`
- `codex/hook/PostToolUse`
- `codex/hook/Stop`
- `claude/hook/*`
- `turn_started`
- `turn_completed`
- `terminal_done`
- `session_completed`
- `clear_done`

### Progress Evidence

Progress evidence can update `liveActivity`, but must not close a turn:

- `assistant-message`
- `assistant-response`
- `assistant-message-complete`
- `assistant-response-complete`
- `item/agentMessage/delta`
- `item/assistantMessage/delta`
- `item/commandExecution/outputDelta`
- `item/fileChange/outputDelta`

### Fallback Evidence

Fallback evidence is useful only when explicit evidence is absent:

- tmux pane title spinner
- legacy `codex-pty-session-*` heartbeat
- terminal-output pattern detection without hook identity

Fallback evidence cannot override explicit completion or read state.

## Reducer Rules

1. `brainbase/input-submit` opens `starting` with `confidence: explicit`.
2. `turn_started(turnId)` opens one active turn and transitions to `running`.
3. `turn_completed(turnId)` closes only the matching turn.
4. If `turn_completed(turnId)` leaves other active turns open, state remains `running`.
5. `terminal_done` or `session_completed` closes every active turn for the session and transitions to `done-unread`.
6. `assistant-response-complete` and `assistant-message-complete` are progress evidence, not terminal completion.
7. `user-input-requested` transitions to `waiting` only when the session is actually waiting for user action.
8. `clear_done` records `readAt` and transitions to `idle`.
9. Fallback evidence can move `idle` to `starting` only when there is no explicit done/read tombstone newer than the fallback.
10. Fallback evidence cannot move `done-unread` or read `idle` back to blue.
11. Stale fallback turns must expire by TTL unless corroborated by explicit hook evidence.

## Invariants

- `state === 'done-unread'` implies `activeTurns.length === 0`.
- `state === 'idle'` after `clear_done` cannot be reopened by tmux spinner alone.
- `state === 'running'` requires at least one active turn or explicit working evidence newer than the last terminal done/read event.
- `state === 'waiting'` is not green. Waiting means blocked on user input, not completed unread work.
- `liveActivity.statusTone` is display metadata and must not override `state`.
- API, WebSocket, client indicator, and timeline sort must consume the same state.
- Polling and WebSocket full-status messages must remove sessions that are absent from the server status map.

## Timeline Sort Contract

Timeline sort uses only canonical activity state priority:

| Priority | States |
| --- | --- |
| 1 | `running`, `starting`, `waiting` |
| 2 | `done-unread` |
| 3 | `idle` |

Within the same priority, sort by existing session timestamp rules.

Sort must not inspect `currentStep`, `statusTone`, `lastEventType`, tmux pane title, or compatibility booleans directly.

## API and WebSocket Contract

`GET /api/sessions/status` and activity WebSocket messages should expose:

```json
{
  "session-123": {
    "state": "running",
    "confidence": "explicit",
    "activeTurnCount": 1,
    "isWorking": true,
    "isDone": false,
    "lastEventType": "turn_started",
    "liveActivity": {}
  }
}
```

`state` is authoritative. `isWorking`, `isDone`, and `activeTurnCount` are compatibility projections.

## Client Contract

The client may keep UI-only state such as selection, transport connection, recent files, and optimistic visual latency. It must not mutate canonical `hookStatus` truth.

`markDoneAsRead(sessionId)` sends `clear_done` to the server. If the client hides the green indicator optimistically, that optimistic value must live outside canonical `hookStatus` and must be replaced by the next server snapshot.

## Required Contract Tests

Before runtime implementation is changed, these tests must exist and fail/pass against the reducer contract rather than incidental booleans:

1. delayed `turn_started` older than terminal done does not reopen blue.
2. stale `codex-pty-session-*` heartbeat after done does not reopen blue.
3. tmux pane-title spinner after `clear_done` does not reopen blue.
4. two active turns with one `turn_completed(turnId)` remains `running`.
5. `terminal_done` with residual active turns becomes `done-unread` and clears all turns.
6. `assistant-response-complete` during an active turn remains `running`.
7. `user-input-requested` becomes `waiting`, not `done-unread`.
8. restored persisted state with `done + activeTurns` normalizes to `done-unread` and persists cleanup.
9. WebSocket `status-full` missing a session id clears that session on the client.
10. timeline sort priority is `running|starting|waiting` before `done-unread` before `idle`.

## Implementation Locations

- Codex notify entry: [scripts/codex-notify.sh](../scripts/codex-notify.sh)
- Codex hook entry: [scripts/codex-hooks-activity.sh](../scripts/codex-hooks-activity.sh)
- Codex PTY fallback: [scripts/codex-pty-shim.py](../scripts/codex-pty-shim.py)
- terminal input entry: [server/services/session-runtime/terminal-io-methods.js](../server/services/session-runtime/terminal-io-methods.js)
- server reducer: [server/services/session-core/activity-service-methods.js](../server/services/session-core/activity-service-methods.js)
- status API: [server/controllers/session/activity-handlers.js](../server/controllers/session/activity-handlers.js)
- WebSocket status push: [server/services/session-activity-ws-service.js](../server/services/session-activity-ws-service.js)
- client WebSocket sync: [public/modules/core/session-activity-ws-client.js](../public/modules/core/session-activity-ws-client.js)
- client state projection: [public/modules/session-ui-state.js](../public/modules/session-ui-state.js)
- client indicator rendering: [public/modules/session-indicators.js](../public/modules/session-indicators.js)
- timeline sort: [public/modules/ui/views/session-view.js](../public/modules/ui/views/session-view.js)

## VibePro / Graphify Operating Rule

Any PR that touches active indicators, realtime session state, hooks, terminal transport, status API, WebSocket sync, or timeline sort must include a PR section named `Graphify Impact Review`.

Minimum evidence:

```md
## Graphify Impact Review
- command: `vibepro graph . --run-graphify`
- artifact: `.vibepro/graphify/graph.json`
- impacted paths: server reducer, status API, WebSocket, client state, indicator, sort, hook/fallback reporter
```

VibePro and Graphify are impact-review aids. The source of truth is this document, the capability map, implementation code, tests, runtime API responses, and logs.
