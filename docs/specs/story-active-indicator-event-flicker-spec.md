# Spec: Active indicator event flicker

## Invariants

- INV-1: `sessionUi.byId[sessionId].hookStatus` is the client-side render source of truth for session activity indicators.
- INV-2: WebSocket activity updates and `/api/sessions/status` snapshots must be reconciled into the same hook status store.
- INV-3: Polling reconciliation must remain active while the WebSocket is connected so cold-load hydration and missed startup messages are corrected.
- INV-4: Agent activity requires explicit lifecycle evidence from Brainbase input, Codex hooks/PTY shim, Claude hooks, terminal done, or clear-done state.
- INV-5: A connected terminal transport alone must not mark a session as working.
- INV-6: Static tmux pane titles such as `Claude Code` or empty pane titles must not be treated as working evidence.
- INV-7: Claude hook activity must still resolve a Brainbase session when `BRAINBASE_SESSION_ID` is missing but the hook process has a project/worktree path.

## Contracts

- CON-1: `startActivityWs()` starts polling reconciliation before connecting the activity WebSocket and stops it only in its cleanup function.
- CON-2: WebSocket full snapshots and polling snapshots both use the normalized hook status map and emit `SESSION_UI_STATE_CHANGED` only for changed sessions.
- CON-3: Claude activity bridge resolves session id in priority order: `BRAINBASE_SESSION_ID`, tmux session name, then `/api/state` path matching.
- CON-4: `run-hook.sh` preserves the hook caller cwd as `BRAINBASE_HOOK_ORIGINAL_CWD` before changing directory.

## Scenarios

- S-1: Browser cold-loads while `/api/sessions/status` already reports a working session. The indicator hydrates without waiting for another WebSocket message.
- S-2: Activity WebSocket is connected but misses a startup status. The next polling reconciliation updates `sessionUi.byId`.
- S-3: Claude hook runs without `BRAINBASE_SESSION_ID`, but its project path matches a Brainbase session in `/api/state`. The hook posts working and done activity for that session.
- S-4: A session has `transport-connected` evidence but no hook or explicit activity evidence. The indicator remains idle.
- S-5: A tmux pane title is `Claude Code` or blank. The pane title fallback does not produce a working indicator by itself.

## Anti-patterns

- AP-1: Stopping `/api/sessions/status` polling permanently after WebSocket connection succeeds.
- AP-2: Treating terminal connectivity as equivalent to agent activity.
- AP-3: Treating static pane titles as activity evidence.
- AP-4: Requiring only `BRAINBASE_SESSION_ID` in Claude hooks when project/worktree path evidence is available.

## Verification

- V-1: `npm run test:run -- tests/unit/session-indicators-ws.test.js`
- V-2: `npx tsx .claude/scripts/test/test-activity-bridge-hooks.ts`
- V-3: `npm run typecheck`
- V-4: `npm run vibepro:development-dag`
- V-5: `npm run vibepro:score-verify`
- V-6: `npm run vibepro:doc-trace`
