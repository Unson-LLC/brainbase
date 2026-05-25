---
spec_id: SPEC-codex-appserver-indicator-stability
title: Codex App Server activity indicator stability
status: draft
date: 2026-05-25
story_id: story-codex-appserver-indicator-stability
related_adrs:
  - ADR-codex-appserver-indicator-stability
implementation_files:
  - server/services/codex-app-server-activity-bridge.js
  - docs/brainbase-capabilities/capabilities/codex.app-server.yml
test_files:
  - tests/server/services/codex-app-server-activity-bridge.test.js
---

# SPEC: Codex App Server activity indicator stability

## 目的

Route structured Codex App Server turn notifications into Brainbase's existing `hookStatus` activity state so Codex App Server-backed sessions can drive stable active/done indicators.

## Invariants

- **INV-1**: The bridge must not change terminal transport behavior.
- **INV-2**: The bridge must call the existing activity service instead of writing browser UI state directly.
- **INV-3**: A notification without a resolvable Brainbase `sessionId` must be ignored.
- **INV-4**: `turn/started` must report `status=working`, `lifecycle=turn_started`, and a stable App Server `turnId`.
- **INV-5**: `turn/completed` must report `status=done`, `lifecycle=turn_completed`, and the matching App Server `turnId`.
- **INV-6**: The bridge must be detachable.
- **INV-7**: App Server activity events must remain distinguishable by `latestEvidence=codex app-server notification`.

## Contracts

### Contract-1: Bridge constructor

```js
new CodexAppServerActivityBridge({
  adapter,
  activityService,
  sessionId,
  sessionIdResolver,
  now,
  logger
})
```

- `adapter` is an EventEmitter-compatible `CodexAppServerAdapter`.
- `activityService.reportActivity(sessionId, status, reportedAt, metadata)` is required.
- `sessionId` is optional default context.
- `sessionIdResolver(params, notification)` can resolve a session id from notification payloads.
- `now()` is injectable for deterministic tests.

### Contract-2: Lifecycle

```js
bridge.attach()
bridge.detach()
```

- `attach()` subscribes to adapter `notification` events.
- Repeated `attach()` is idempotent.
- `detach()` removes the listener.

### Contract-3: Notification mapping

Supported methods:

- `turn/started`
- `turn/completed`
- `task_started`
- `task_complete`
- `codex/event/task_complete`

Mapping:

- Start events call `activityService.reportActivity(sessionId, 'working', timestamp, metadata)`.
- Completion events call `activityService.reportActivity(sessionId, 'done', timestamp, metadata)`.
- `metadata.eventType` is the App Server notification method.
- `metadata.turnId` is read from `params.turn.id`, `params.turnId`, or `params.turn_id`.
- `metadata.activityKind` is `task_started` or `task_completed`.
- `metadata.currentStep` is a short Japanese UI label.
- `metadata.latestEvidence` is `codex app-server notification`.

## Verification

```bash
npm run test:run -- tests/server/services/codex-app-server-activity-bridge.test.js tests/server/services/codex-app-server-adapter.test.js tests/unit/session-ui-state.test.js
npm run typecheck
git diff --check
git diff --name-only -- public/modules/core/terminal-transport-client.js scripts/codex-pty-shim.py server/services/session-runtime
```

Expected:

- `turn/started` produces an activity report that becomes working with an active App Server turn id.
- `turn/completed` produces an activity report that clears the same turn id and marks done.
- Missing session id notifications are ignored.
- Attach/detach listener lifecycle is deterministic.
- Existing adapter tests still pass.
- Existing session UI state derivation still maps working/done hook status into indicator activity.
- Terminal transport files are unchanged.

## Scope exclusions

- Browser UI rewrites
- New public API routes
- Codex session runtime migration
- App Server event ledger persistence
- Graph SSOT writes
