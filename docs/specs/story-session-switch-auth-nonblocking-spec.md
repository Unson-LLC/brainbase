---
story_id: story-session-switch-auth-nonblocking
title: Spec — non-blocking auth verify in connect()
status: active
---

## Invariants

- **INV-1 (non-blocking)**: `connect()` must not await `_ensureAuthenticated()`. A slow or
  never-resolving `GET /api/auth/verify` must not delay WS open / `ready` / connect resolution.
- **INV-2 (verify still fires)**: `_ensureAuthenticated()` is still invoked on connect
  (fire-and-forget), so any best-effort server-side effect and error-surfacing is preserved.
- **INV-3 (happy path intact)**: a connect whose verify resolves still resolves `mode:live` on
  `ready`; a connect whose verify rejects still continues (verify swallows its own errors).

## Constraints

- **CON-1**: `_ensureAuthenticated()` already swallows its own errors, so fire-and-forget
  introduces no unhandled rejection.
- **CON-2**: `/api/auth/verify` is a pure read (no cookie/token mutation) and the WS upgrade
  authenticates independently, so removing the await from the critical path cannot change access.

## Scenarios

- **S-1 (hanging verify)**: verify never resolves -> connect still reaches `ready` and resolves.
- **S-2 (normal verify)**: verify resolves -> connect resolves `mode:live` (no regression).

## Anti-patterns

- **AP-1**: awaiting a best-effort call whose result is discarded in a latency-critical path.
- **AP-2**: removing the verify call entirely (would drop any server-side side-effect /
  error-surfacing) — keep it, just don't await it.

## Verification

`tests/unit/terminal-transport-auth-nonblocking.test.js` covers S-1 (hanging verify, 500ms
wall-clock guard). `tests/e2e/story-session-switch-auth-nonblocking-xterm.spec.js` covers S-1 and
S-2 in a real browser. INV-2/CON-1 hold by construction (`void this._ensureAuthenticated()`).
