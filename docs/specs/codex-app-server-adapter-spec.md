---
spec_id: SPEC-codex-app-server-adapter
title: Codex App Server adapter first slice
status: draft
date: 2026-05-22
story_id: story-codex-app-server-adapter
related_adrs:
  - ADR-codex-app-server-adapter
implementation_files:
  - server/services/codex-app-server-adapter.js
test_files:
  - tests/server/services/codex-app-server-adapter.test.js
---

# SPEC: Codex App Server adapter first slice

## 目的

Add a small backend adapter that lets Brainbase talk to `codex app-server` over stdio JSON-RPC without depending on terminal snapshots.

## Invariants

- **INV-1**: No JSON-RPC request except `initialize` is sent before successful initialization.
- **INV-2**: `initialized` notification is sent after a successful `initialize` response.
- **INV-3**: Each request id maps to exactly one pending Promise.
- **INV-4**: JSON-RPC responses with `error` reject the matching pending request.
- **INV-5**: Notifications without `id` are emitted and do not affect pending requests.
- **INV-6**: Process exit rejects all pending requests.
- **INV-7**: Malformed stdout lines are emitted as parse errors and do not crash the process.
- **INV-8**: The adapter defaults to stdio and does not expose WebSocket transport in this slice.

## Contracts

### Contract-1: Adapter constructor

```js
new CodexAppServerAdapter({
  codexCommand,
  codexArgs,
  cwd,
  env,
  spawnFn,
  clientInfo,
  requestTimeoutMs,
  logger
})
```

- `codexCommand` defaults to `codex`.
- `codexArgs` defaults to `['app-server']`.
- `spawnFn` is injectable for tests.
- `clientInfo` defaults to Brainbase metadata.

### Contract-2: Lifecycle

```js
await adapter.start()
await adapter.stop()
```

- `start()` spawns the process, sends `initialize`, waits for the response, sends `initialized`, then resolves.
- Repeated `start()` is idempotent while the adapter is running.
- `stop()` terminates the process and clears pending requests.

### Contract-3: Requests and notifications

```js
await adapter.request(method, params, options)
adapter.notify(method, params)
```

- `request()` writes one JSON object plus newline to stdin.
- `notify()` writes one JSON object plus newline without an id.
- `request()` rejects if the adapter is not running.
- `request()` rejects on timeout.

### Contract-4: Codex helpers

```js
await adapter.startThread({ model, cwd, metadata })
await adapter.startTurn({ threadId, input, model, cwd })
await adapter.interruptTurn({ threadId, turnId })
```

- `startThread()` calls `thread/start`.
- `startTurn()` requires `threadId` and `input`, then calls `turn/start`.
- `interruptTurn()` requires `threadId` and `turnId`, then calls `turn/interrupt`.

### Contract-5: Events

The adapter emits:

- `notification` with the raw notification object
- `notification:<method>` with the notification params
- `parse_error` for malformed stdout
- `exit` when the child process exits
- `stderr` when stderr data is available
- `child_error` when the child process emits `error`

## Verification

```bash
npm test -- tests/server/services/codex-app-server-adapter.test.js
codex app-server --help
BRAINBASE_E2E_REUSE_SERVER=true npx playwright test tests/e2e/story-codex-app-server-adapter-contract.spec.ts --project=chromium
git diff --name-only -- public/modules/core/terminal-transport-client.js scripts/codex-pty-shim.py server/services/session-runtime
```

Expected:

- request/response matching passes
- initialization handshake passes
- thread/turn helpers send the expected methods
- interrupt helper sends `turn/interrupt`
- notifications are emitted
- malformed stdout emits `parse_error`
- requests reject before initialization
- request timeout cleans up pending state
- stop rejects pending requests and clears running state
- child process errors reject pending requests without requiring an `error` listener
- initialization failure clears process state so `start()` can be retried
- process exit rejects pending requests
- local Codex CLI exposes `app-server`
- existing terminal/xterm transport paths remain unchanged by this slice

## Scope exclusions

- Browser UI
- `/api/...` route contract
- persistent Brainbase session state
- Graph SSOT context injection
- WebSocket transport
