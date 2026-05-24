# Spec: Terminal stale runtime auto recovery

## Invariants

- INV-1: An active session with a live tmux pane and a persisted `ttydProcess`
  must not be reported healthy when no matching ttyd process exists.
- INV-2: Missing ttyd transport must be recoverable without killing tmux when
  the pane itself is not classified as corrupt or error-flooded.
- INV-3: Sessions that intentionally have no hot terminal transport remain
  snapshot-only unless state claims an active ttyd process should exist.

## Contracts

- CON-1: `TerminalRuntimeReconciler.observe()` is the source of truth for
  comparing persisted session runtime state, observed tmux state, and observed
  ttyd processes.
- CON-2: `TerminalRuntimeReconciler._classifyRuntimeState()` returns a critical
  `stale_ttyd_process` issue when `entry.session.ttydProcess` exists, tmux
  exists, and observed ttyd processes for that session are empty.
- CON-3: `reconcile({ recover: true })` uses `startTtyd({ forceTtyd: true })`
  for stale ttyd recovery, preserving tmux/Codex while recreating the browser
  terminal transport.
- CON-4: `stale_ttyd_process` classification takes precedence over terminal
  ownership state because a dead transport cannot be recovered by ownership
  gating alone.
- CON-5: Watchdog reconciliation logs successful `reconnect_ttyd` as recovered
  and failed `reconnect_ttyd` separately as failed, so operational logs do not
  claim repair when ttyd reconnection failed.
- CON-6: Reconnect cwd resolution uses `session.worktree.path`, then
  `session.path`, then `session.cwd`; the chosen cwd is passed to `startTtyd`
  so ttyd reconnects to the same project surface the session owns.
- CON-7: Operator-visible recovery surfaces (`/api/terminal/reconcile`,
  `/api/health/terminal`, and session terminal recovery) expose the same issue
  and action semantics as the reconciler instead of hiding stale runtime state.
- CON-8: Failed stale ttyd reconnects restore the previously persisted
  `ttydProcess` marker so subsequent health/reconcile passes still classify the
  session as stale instead of snapshot-only.
- CON-9: Startup-pending or startup-failed shell sessions keep the existing
  startup guard semantics and must not be promoted into stale ttyd recovery or
  terminal snapshot/runtime readiness flows.
- CON-10: Session runtime query refreshes stale ttyd classification with a
  dry-run reconcile when the runtime registry is cold, so the first browser open
  after restart chooses terminal recovery instead of a destructive ensure path.
## Scenarios

- S-1: Brainbase server restarts. `session.ttydProcess` still points at the old
  pid/port, tmux exists, and `ps` has no matching ttyd. Health is degraded and
  recovery ensures runtime.
- S-2: A hibernated/lazy active session has tmux but no persisted
  `ttydProcess`. Health remains snapshot-only unless a fresh probe or gateway is
  present.
- S-3: A Codex pane error flood is still handled by the stronger full runtime
  restart path and is not downgraded to ttyd-only recovery.
- S-4: A stale persisted ttyd with an active owner still reports
  `stale_ttyd_process`, not `blocked_by_owner`.
- S-5: A session with `worktree.path`, `path`, and `cwd` reconnects ttyd from
  `worktree.path`.
- S-6: Reconnect starts a replacement ttyd but readiness fails; the previous
  persisted pid/port remains in state so the issue is still visible and
  retryable.
- S-7: Boot restore sees a live process with the persisted pid but no observed
  ttyd attached to the session; it does not treat pid liveness alone as proof
  of a usable transport.
- S-8: A session is still pending or failed during startup. Runtime query,
  hibernation eligibility, and terminal handlers preserve the startup guard
  instead of attempting stale ttyd recovery.
- S-9: The browser opens a session before the watchdog has populated
  runtimeRegistry. `/api/sessions/:id/runtime` still returns
  `stale_ttyd_process`, and the UI calls terminal recovery rather than generic
  terminal ensure.
- S-10: Legacy `repairActiveTtydSessions` runs after reconciler watchdog work.
  Startup-pending/failed shell sessions with a persisted `ttydProcess` are
  skipped there as well as in the reconciler.
## Anti-patterns

- AP-1: Treating active tmux alone as sufficient evidence that the browser
  terminal is interactive.
- AP-2: Clearing stale runtime state without starting a replacement transport.
- AP-3: Reusing stale persisted pid/port as proof that ttyd is running.
- AP-4: Treating `startupStatus: pending` or `startupStatus: failed` as a stale
  ttyd issue before the session has completed workspace/runtime setup.
- AP-5: Falling back to `/terminal/ensure` for a stale persisted ttyd marker
  merely because the runtime registry has not yet been refreshed.

## Non-goals

- NG-1: Shell or ttyd binary discovery behavior is out of scope for this story,
  including existing platform-specific `USERPROFILE` fallback paths. The stale
  runtime recovery change must not modify those branches.

## Verification

- V-1: `npm test -- tests/unit/terminal-runtime-reconciler.test.js`
- V-2: `npm test -- tests/unit/session-runtime-maintenance-methods.test.js`
- V-3: `npm test -- tests/unit/terminal-runtime-api-surfaces.test.js`
- V-4: `BRAINBASE_E2E_REUSE_SERVER=true npx playwright test tests/e2e/story-terminal-stale-runtime-auto-recovery-contract.spec.ts --project=chromium`
- V-5: `npm run typecheck`
- V-6: Live smoke on a non-canonical test port loads the browser UI and receives
  200 responses from state, runtime, snapshot, ensure/probe, and terminal health
  endpoints without failed browser requests.
- V-7: `vibepro pr prepare . --base origin/develop --story-id story-terminal-stale-runtime-auto-recovery`
