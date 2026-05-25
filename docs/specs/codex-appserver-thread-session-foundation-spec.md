---
spec_id: SPEC-codex-appserver-thread-session-foundation
title: Codex App Server thread session foundation
status: draft
date: 2026-05-25
story_id: story-codex-appserver-thread-session-foundation
related_adrs:
  - ADR-codex-appserver-thread-session-foundation
implementation_files:
  - public/modules/domain/session/session-display-route.js
  - public/modules/session-ui-state.js
test_files:
  - tests/domain/session/session-display-route.test.js
  - tests/unit/session-ui-state.test.js
  - tests/e2e/story-codex-appserver-thread-session-foundation-contract.spec.ts
---

# SPEC: Codex App Server thread session foundation

## Invariants

- **INV-1**: Only sessions with `engine === 'codex'` can use `codex_app_server` display mode.
- **INV-2**: `session.codexAppServer.threadId` is the primary App Server thread identity.
- **INV-3**: `session.codexAppServer.restore.threadId` is accepted only when the primary thread id is absent.
- **INV-4**: `session.codexAppServer.stale === true` disables App Server display eligibility.
- **INV-5**: stale App Server metadata and missing App Server metadata must produce distinct fallback reasons so future UI consumers can explain why App Server display was suppressed.
- **INV-6**: Missing App Server metadata falls back to `terminal_xterm`.
- **INV-7**: Claude Code sessions always use `terminal_xterm`.
- **INV-8**: This slice only exposes a route; it does not replace terminal input, xterm rendering, or tmux snapshots.

## Contracts

### Contract-1: Route derivation

```js
deriveSessionDisplayRoute(session)
```

Returns:

```js
{
  mode: 'codex_app_server' | 'terminal_xterm',
  reason: string,
  codexAppServerThreadId: string | null,
  terminalFallback: boolean
}
```

`terminalFallback` is `true` only when the preferred route is App Server and xterm remains available as an explicit fallback.

### Contract-2: UI state exposure

```js
deriveSessionUiState(sessionId).displayRoute
```

The field is read-only derived state. Existing consumers can ignore it. Later PRs can use it to select the Codex App Server transcript panel without changing terminal transport.

## Verification

```bash
npm run test:run -- tests/domain/session/session-display-route.test.js tests/unit/session-ui-state.test.js
npm run test:e2e -- tests/e2e/story-codex-appserver-thread-session-foundation-contract.spec.ts
git diff --name-only -- public/modules/core/terminal-transport-client.js public/modules/app/terminal-display-mixin.js scripts/codex-pty-shim.py server/services/session-runtime
```

Expected:

- Route derivation tests pass.
- `deriveSessionUiState()` exposes route metadata.
- Contract E2E covers all Story acceptance criteria with Story/ADR/Spec/code/test anchors.
- Terminal transport paths show no diff.
