---
adr_id: ADR-codex-appserver-repl-activity-bridge
title: Codex App Server REPL activity bridge completion
status: proposed
story:
  story_id: story-codex-appserver-repl-activity-bridge
  story_path: docs/stories/story-codex-appserver-repl-activity-bridge.md
created_at: 2026-05-25
updated_at: 2026-05-25
---

# ADR-codex-appserver-repl-activity-bridge: Codex App Server REPL activity bridge completion

## Context

Brainbase has two Codex App Server notification paths:

- backend adapter tests that use `CodexAppServerActivityBridge`
- the user-facing terminal REPL script `scripts/codex-app-repl.mjs`

The REPL script runs outside the server process, so it cannot call `CodexAppServerActivityBridge` directly. It can, however, send the same structured lifecycle data to existing HTTP APIs.

## Decision

Create a small REPL activity client helper that maps App Server notifications into the same Brainbase activity and session-state contract:

- `turn/started` -> `/api/sessions/report_activity` with `lifecycle=turn_started`, `eventType=turn/started`, and the App Server turn id
- `turn/completed` and terminal App Server completion aliases -> `/api/sessions/report_activity` with `lifecycle=turn_completed`
- App Server thread/turn metadata -> `PATCH /api/state/sessions/:sessionId` under `session.codexAppServer`
- Failed REPL HTTP writes -> one stderr warning per endpoint/method so a wrong port, CSRF failure, or server error is visible in the REPL process logs.

This keeps `activityService.reportActivity()` as the server-side owner of `hookStatus`, and keeps the Brainbase session record as the durable owner of App Server identity.

## Boundaries

- `scripts/codex-app-repl.mjs` owns local App Server stdio interaction and terminal REPL UX.
- `scripts/lib/codex-app-server-activity-client.mjs` owns HTTP payload construction for REPL activity and state metadata.
- `/api/sessions/report_activity` remains the activity indicator ingestion point.
- `/api/state/sessions/:sessionId` remains the session metadata persistence point.
- `server/services/codex-app-server-session-state.js` remains the server-side contract reference for durable metadata semantics.

## Invariants

- **INV-1**: The REPL path must not directly write browser state.
- **INV-2**: App Server thread and turn ids must come from structured App Server messages or request responses, not terminal text.
- **INV-3**: Completion must clear a known active App Server turn id.
- **INV-4**: Missing Brainbase session id must remain non-mutating.
- **INV-5**: Claude Code sessions must not be routed through this REPL helper.
- **INV-6**: Terminal/xterm transport files must remain unchanged.

## Verification Plan

- Unit tests for pure payload construction and state patch generation.
- Existing activity bridge and session-state tests.
- Protected-path diff check for terminal/xterm transport files.
- PR-readiness evidence must label helper and Playwright checks as contract/runtime-local evidence, not as proof that `31013` already runs the branch.
- 31013 smoke after merge that checks `/api/version`, `/api/sessions/status`, `/api/state`, and browser row state.
