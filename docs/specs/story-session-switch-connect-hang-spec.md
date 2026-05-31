---
story_id: story-session-switch-connect-hang
title: Spec — superseded terminal connect settles deterministically
status: active
---

## Invariants

- **INV-1 (always settles)**: Every `connect()` Promise settles exactly once — via `ready`
  (`resolve mode:live`), `blocked` (`resolve mode:blocked`), `error`/`timeout` (`reject`),
  or supersession (`reject superseded`). No code path leaves it pending forever.
- **INV-2 (timeout preserved)**: For a connect whose token is never bumped, a missing `ready`
  still rejects at `CONNECT_TIMEOUT_MS` (15000ms).
- **INV-3 (observable)**: After any settle, `this._lastConnectMetric` holds `{ outcome,
  durationMs, sessionId, token, switchingSessions }`, and `this.onConnectMetric?.(metric)` is
  invoked best-effort.

## Constraints

- **CON-1**: The supersede rejecter bypasses `settle()`'s `_connectToken` guard on purpose —
  that guard is the exact mechanism that would otherwise strand the promise.
- **CON-2**: The fix must not change happy-path behavior: a normal `ready` connect still
  resolves `mode:live`; a `blocked` message still resolves `mode:blocked`. Existing transport
  tests stay green.

## Scenarios

- **S-1 (orphan via re-entry)**: connect(A) pending → connect(A) again bumps `_connectToken`
  → the first promise rejects `superseded`; `_connectXtermTransport` catches → `switchSession`
  returns `snapshot_fallback` (no hang).
- **S-2 (auth-gap race)**: a second connect bumps the token during the first connect's
  `await _ensureAuthenticated()` gap → when the first executor runs it sees the bumped token
  and rejects `superseded` immediately.
- **S-3 (lone timeout)**: a single never-ready connect rejects at `CONNECT_TIMEOUT_MS`.

## Anti-patterns

- **AP-1**: Relying solely on `CONNECT_TIMEOUT_MS` — it is token-gated and defeated by
  supersession.
- **AP-2**: Resolving a superseded connect as success (would make the stale switch appear
  live). Supersession is a rejection.
- **AP-3**: A single `_supersedeConnect` slot without the executor-entry token re-check —
  the auth-gap race (S-2) would still strand the first promise.

## Verification

`tests/unit/terminal-transport-connect-supersede.test.js` covers S-1 (orphan rejects, not
HUNG), S-3 (timeout), and INV-3 (live metric). S-2 is structurally covered: the unit test's
synchronous double-connect exercises the auth-gap ordering, and INV-1's executor-entry
re-check is what makes it pass.
