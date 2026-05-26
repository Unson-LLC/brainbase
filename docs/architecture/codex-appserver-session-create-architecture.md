# ADR: Codex App Server backed session creation

## Decision

New Codex session creation becomes the explicit boundary that opts into the existing App Server REPL path. The browser sends `codexAppServer: true` for regular Codex creation, and the server-side worktree creation path sets the same intent internally for Codex. Runtime startup translates that intent into `BRAINBASE_CODEX_APP_SERVER=1`, which activates `scripts/codex-app-repl.mjs` from `login_script.sh` / `ensure_session_runtime.sh`.

The start handler waits for durable `session.codexAppServer` thread metadata before returning success for an App Server-requested Codex session. Without that wait, the UI can reload state before the REPL posts metadata and incorrectly route the newly created session to xterm.

## Boundaries

- `codexAppServer: true` is an explicit creation/start intent, not a blanket rule for every legacy Codex terminal ensure.
- Claude Code never receives the App Server flag.
- Existing Codex sessions without metadata keep their fallback route.
- The runtime still uses tmux/ttyd as the process host in this slice; the browser display route decides whether xterm is shown.

## Consequences

- A new Codex session that cannot persist App Server metadata fails creation instead of appearing as a legacy Codex session.
- App Server metadata becomes observable immediately in `/api/state` after successful creation.
- The next transcript/input story can build on a creation path that already has thread identity.
