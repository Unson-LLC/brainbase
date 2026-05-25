---
story_id: story-codex-appserver-repl-activity-bridge
title: Codex App Server REPL activity bridge completion
source_requirement:
  nocodb_table: none
  requirement_id: none
  requirement_title: User-requested VibePro completion after manual smoke
architecture_docs:
  - path: docs/architecture/codex-appserver-repl-activity-bridge-architecture.md
    status: created
related_tasks:
  - task_source: VibePro
    task_ids: []
status: draft
created_at: 2026-05-25
updated_at: 2026-05-25
---

# story-codex-appserver-repl-activity-bridge: Codex App Server REPL activity bridge completion

## Background

The previous Codex App Server session-state story added durable `session.codexAppServer` metadata and a backend notification bridge. A manual smoke on port `31013` showed that the current user-facing `scripts/codex-app-repl.mjs` path still reports activity through the legacy Codex hook-style `/api/sessions/report_activity` payload.

That path can raise `isWorking=true`, but it does not persist App Server thread metadata and it can leave a turn active after completion. The App Server REPL must send structured lifecycle metadata that matches the App Server bridge contract.

## Current State

- `scripts/codex-app-repl.mjs` starts `codex app-server` for opt-in Codex sessions.
- `scripts/codex-app-repl.mjs` reports only `{ sessionId, status, reportedAt }` to `/api/sessions/report_activity`.
- `turn/completed` currently does not report completion through the same structured lifecycle used by `CodexAppServerActivityBridge`.
- `session.codexAppServer` remains unset for the REPL path even though the App Server thread and turn ids are known locally.

## Change

- Add a small App Server activity client helper for the REPL path.
- Report `turn/started` and `turn/completed` with lifecycle, event type, turn id, activity kind, current step, and App Server evidence.
- Persist Codex-only App Server metadata through the existing session state API.
- Surface REPL HTTP reporting failures to stderr instead of silently swallowing failed `/api/sessions/report_activity` or `/api/state/sessions/:sessionId` writes.
- Preserve existing terminal/xterm transport and Claude Code behavior.
- Keep full App Server item/event persistence out of scope.

## Acceptance Criteria

- [ ] A Codex App Server REPL turn start sends structured `turn_started` activity and produces `isWorking=true`.
- [ ] A Codex App Server REPL turn completion sends structured `turn_completed` activity and clears the active turn.
- [ ] The REPL path persists `session.codexAppServer.threadId` and active/completed turn lifecycle metadata for Codex sessions.
- [ ] Completion without a turn id does not leave a single App Server turn active indefinitely.
- [ ] The REPL path does not mutate Claude Code session metadata.
- [ ] Existing terminal/xterm transport files remain unchanged.
- [ ] Capability Map documents the REPL activity bridge path.
- [ ] Unit tests cover payload construction for start, completion, missing ids, and state patch metadata.
- [ ] PR evidence distinguishes contract/runtime verification from post-merge `31013` live verification; do not claim `31013` reflects this fix until the merged commit is proven through `/api/version`, `/api/sessions/status`, `/api/state`, and the browser row state.

## Out Of Scope

- Replacing ttyd/xterm transport.
- Persisting full App Server event item timelines.
- Changing Codex model, auth, sandbox, or approval defaults.
- Writing App Server events into Graph SSOT.
- Changing Claude Code startup, resume, or activity behavior.

## Release Claim Boundary

This PR can prove the REPL contract, helper behavior, and unchanged terminal/xterm scope before merge. It cannot honestly prove that port `31013` is already running the branch commit before the branch is merged and the launchd runtime is restarted or refreshed. The live-runtime claim is therefore a post-merge verification step, not a PR-readiness substitute.
