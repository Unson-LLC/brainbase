---
spec_id: SPEC-codex-appserver-session-state-ssot
story_id: story-codex-appserver-session-state-ssot
title: Codex App Server session state SSOT
source_architecture:
  - ADR-codex-appserver-session-state-ssot
source_files:
  - docs/stories/story-codex-appserver-session-state-ssot.md
  - docs/architecture/codex-appserver-session-state-ssot-architecture.md
  - docs/brainbase-capabilities/capabilities/codex.app-server.yml
  - server/services/codex-app-server-session-state.js
  - server/services/codex-app-server-activity-bridge.js
  - server/services/session-runtime/runtime-query-methods.js
created_at: 2026-05-25
updated_at: 2026-05-25
---

# SPEC-codex-appserver-session-state-ssot: Codex App Server session state SSOT

## Objective

Define and verify the Codex-only session-state contract for Codex App Server thread, turn, and restore metadata before App Server becomes a primary Codex execution path.

## Requirements

- **REQ-1**: Codex App Server thread identity must have a named durable owner in Brainbase session state.
- **REQ-2**: App Server session metadata must be read or written only when the session engine is `codex`.
- **REQ-3**: Claude Code sessions must not receive App Server metadata and must keep existing restore semantics.
- **REQ-4**: Active App Server turn identity must continue to flow through existing `hookStatus` activity state.
- **REQ-5**: Missing or stale App Server metadata must produce an explicit recovery/fallback outcome.
- **REQ-6**: Full App Server event item persistence must remain out of scope unless this story adds a ledger contract.
- **REQ-7**: Terminal/xterm transport must remain unchanged.
- **REQ-8**: App Server notification handling must not create or mutate a session when the Brainbase session id is missing, unknown, or cannot be resolved after state reload.
- **REQ-9**: Session-state writes for App Server metadata must return explicit non-mutating outcomes for missing session ids, missing state-store support, unsupported engines, and unknown sessions.
- **REQ-10**: Runtime inventory process rows with no matching Brainbase session id must not infer Codex App Server thread ownership or attach restore metadata.
- **REQ-11**: State API updates where `sessionIndex === -1` after reload must return the existing not-found response instead of creating a session or attaching `session.codexAppServer`.
- **REQ-12**: Runtime matching where `matches.length === 0 || !session.id` must continue to ignore the process row for App Server ownership and restore identity.

## Acceptance Mapping

| Acceptance Criterion | Verification |
|---|---|
| Store App Server thread id for Codex sessions | Unit test around session metadata persistence |
| Associate active App Server turn id with activity state | Existing bridge tests plus new metadata contract test |
| Restore `engine: codex` using App Server metadata | Runtime restore/reconcile unit or contract test |
| Claude Code non-mutation | Test with `engine: claude` session fixture |
| Missing/stale metadata explicit fallback | Test stale/missing fixture outcomes |
| Event ledger out of scope or defined | Spec/capability check and PR gate evidence |
| Terminal transport unchanged | Protected-path git diff check |
| Capability Map updated | Capability file diff and VibePro requirement gate |
| Missing or unknown session id is non-mutating | Unit or contract test for bridge/session-state negative path |
| Unmatched runtime row is ignored for App Server ownership | Runtime inventory test or unchanged existing no-match behavior |

## Non-Goals

- Claude Code runtime migration.
- Terminal/xterm protocol changes.
- Graph SSOT writes.
- Remote WebSocket App Server exposure.
- Full event timeline UI.

## Verification Commands

Implementation PRs for this story should include at least:

```bash
npm run test:run -- <codex-appserver-session-state-tests>
npm run test:run -- tests/server/services/codex-app-server-activity-bridge.test.js tests/server/services/codex-app-server-adapter.test.js
npm run test:run -- tests/server/services/codex-app-server-session-state.test.js tests/server/session-runtime-inventory.test.js
npm run typecheck
git diff --name-only -- public/modules/core/terminal-transport-client.js scripts/codex-pty-shim.py
```

The protected-path command must produce no output unless a separate terminal transport story explicitly approves the change. Shared runtime query files may change for Codex restore selection only when tests prove Claude Code restore semantics and terminal transport remain unchanged.
