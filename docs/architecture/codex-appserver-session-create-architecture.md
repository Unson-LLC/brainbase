---
architecture_id: codex-appserver-session-create-architecture
title: Retired Codex App Server backed session creation architecture
status: retired
retired_reason: Brainbase-owned Session Launch Picker and session-creation APIs were retired; Codex app/CLI owns task and worktree creation.
historical_lineage:
  capability: codex.app-server
  current_boundary: project.provisioning
  successor_owner: Codex app/CLI
updated_at: 2026-09-01
---

# Retired ADR: Codex App Server backed session creation

> Retired historical architecture. The decision, boundaries, and consequences
> below describe a former Brainbase-owned session path and are not current
> production requirements. Project Provisioning is the current project
> registration boundary; the Session Launch Picker and server-side
> `/api/sessions` creation APIs are retired and unreachable; Codex app/CLI owns
> task and worktree creation.

## Current ownership boundary

- Project Provisioning owns canonical project identity, Registry/Graph
  registration, and explicit access grants.
- The server-side `session.create`/static endpoint and browser Session Launch
  Picker are retired and unreachable; neither is a Project Provisioning entry
  point or acceptance-evidence surface. This ADR must not be used to restore
  or route through the former `/api/sessions` creation APIs.
- Codex app/CLI owns task and worktree creation and ownership.
- Workspace Setup only consumes the authenticated Project Catalog for a user's
  local path.

## Historical decision (retired)

The former design made new Codex session creation the explicit boundary that
opted into the existing App Server REPL path. The browser sent
`codexAppServer: true` for regular Codex creation, and the server-side worktree
creation path set the same intent internally for Codex. Runtime startup
translated that intent into `BRAINBASE_CODEX_APP_SERVER=1`, which activated
`scripts/codex-app-repl.mjs` from `login_script.sh` /
`ensure_session_runtime.sh`. This is a historical implementation record, not a
current Brainbase route.

The former start handler waited for durable `session.codexAppServer` thread
metadata before returning success for an App Server-requested Codex session.
Without that wait, the historical UI could reload state before the REPL posted
metadata and incorrectly route the newly created session to xterm.

Cold App Server startup could exceed a short fixed wait. The former controller
therefore owned explicit metadata wait defaults: 45 seconds timeout and 250ms
polling interval, with `BRAINBASE_CODEX_APP_SERVER_METADATA_TIMEOUT_MS` and
`BRAINBASE_CODEX_APP_SERVER_METADATA_INTERVAL_MS` as operational overrides.
This historical behavior kept the former failure contract loud while avoiding
false failure during cold startup.

## Historical boundaries (retired)

- In the former implementation, `codexAppServer: true` was an explicit
  creation/start intent, not a blanket rule for every legacy Codex terminal
  ensure.
- In the former implementation, Claude Code never received the App Server
  flag.
- In the former implementation, existing Codex sessions without metadata kept
  their fallback route.
- The former runtime used tmux/ttyd as the process host in that slice; the
  browser display route decided whether xterm was shown.

## Historical consequences (retired)

- A former new Codex session that could not persist App Server metadata failed
  creation instead of appearing as a legacy Codex session.
- App Server metadata became observable immediately in `/api/state` after
  successful historical creation.
- A subsequent transcript/input story could build on the former creation path
  after it had thread identity.
