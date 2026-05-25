---
adr_id: ADR-codex-appserver-session-state-ssot
title: Codex App Server session state SSOT
status: proposed
story:
  story_id: story-codex-appserver-session-state-ssot
  story_path: docs/stories/story-codex-appserver-session-state-ssot.md
created_at: 2026-05-25
updated_at: 2026-05-25
---

# ADR-codex-appserver-session-state-ssot: Codex App Server session state SSOT

## Context

Brainbase has two different concerns that must stay separate:

- terminal/xterm runtime transport for existing Claude Code and Codex sessions
- structured Codex App Server identity for future Codex-native execution

The previous Codex App Server slices added a JSON-RPC adapter and an activity bridge, but deliberately avoided persisting Codex App Server threads and turns. Persisting them now requires a session-state contract that is explicit about engine ownership and restore semantics.

## Decision

Define Codex App Server thread and restore metadata as Codex-only session state. The durable owner is the existing Brainbase session record, not the browser and not Graph SSOT.

The implementation phase should:

- add or formalize a named Codex App Server metadata field under session state
- update that metadata only when `session.engine === 'codex'`
- use App Server metadata only for Codex restore/reconcile decisions
- route turn activity through the existing activity service and `hookStatus`
- keep full App Server item/event persistence out of scope unless a ledger contract is created in this story

## Boundaries

- `server/services/codex-app-server-adapter.js` owns JSON-RPC process and message transport.
- `server/services/codex-app-server-activity-bridge.js` owns notification-to-activity translation.
- Session state owns durable App Server thread/restore metadata for Codex sessions.
- `activityService.reportActivity()` remains the owner of activity indicator state.
- Claude Code resume identity and terminal startup remain owned by existing Claude/session runtime code.

## Invariants

- **INV-1**: Claude Code sessions must not store or consume Codex App Server metadata.
- **INV-2**: App Server thread metadata must not be inferred from terminal text.
- **INV-3**: The browser must not become the source of truth for thread, turn, or restore identity.
- **INV-4**: Graph SSOT must not receive raw App Server events from this path.
- **INV-5**: Existing terminal transport files must remain unchanged unless a terminal transport story is created.
- **INV-6**: Stale or missing App Server metadata must surface as a recoverable state or explicit fallback.

## Consequences

- Codex App Server can become a reliable Codex execution path without weakening Claude Code.
- Codex restore behavior becomes testable because thread identity has one durable owner.
- Full App Server timeline persistence remains a separate product and data-retention decision.

## Alternatives Considered

- Store thread/turn state only in memory: rejected because restart/reconcile behavior would still be undefined.
- Store App Server state in browser session cache: rejected because restore identity must survive browser reloads and runtime restarts.
- Write raw App Server events to Graph SSOT: rejected because Graph SSOT is not an event ledger and requires promotion/curation boundaries.
- Reuse Claude Code resume fields for Codex App Server ids: rejected because it would blur engine ownership and make regressions hard to test.

## Verification Plan

- Unit tests for Codex-only metadata read/write behavior.
- Unit or contract tests proving Claude Code sessions are not mutated by App Server wiring.
- Restore/reconcile tests for missing, stale, and valid Codex App Server metadata.
- Protected-path check for terminal/xterm transport files.
