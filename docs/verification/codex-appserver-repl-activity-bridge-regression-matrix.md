# Codex App Server REPL Activity Bridge Regression Matrix

Story: `story-codex-appserver-repl-activity-bridge`

## Scope Disposition

| Surface | Disposition |
|---|---|
| `scripts/codex-app-repl.mjs` | In scope. Owns App Server stdio interaction and reports structured activity/state metadata through existing HTTP APIs. |
| `scripts/lib/codex-app-server-activity-client.mjs` | In scope. Pure payload/state-patch helper covered by unit and contract tests. |
| `docs/brainbase-capabilities/capabilities/codex.app-server.yml` | In scope. Capability Map is the Brainbase source of truth for Codex App Server surfaces and verification. |
| `server/services/codex-app-server-session-state.js` | Related server-side contract. Existing focused tests pass; no source diff in this PR. |
| `lib/sqlite-store.js` | Related persistence layer. No source diff; behavior exercised through existing session-state service tests. |
| `public/modules/core/event-bus.js`, `public/modules/core/di-container.js` | Graphify-related UI infrastructure only. No browser-state writes were added; helper is Node-only and contract tests assert no browser globals/server internals. |
| `public/modules/domain/file-viewer/file-viewer-service.js`, `public/modules/ui/views/file-viewer-view.js` | Graphify-related through shared modules, not through this REPL path. No source diff and no runtime coupling to App Server activity reporting. |
| `mcp/brainbase/src/indexer/index.ts`, `server/services/conversation-linker.js`, `scripts/poll-sns-feedback-metrics.js`, `scripts/run-sns-scheduled-posts.js`, `tests/server/routes/info-ssot-sim.test.js` | Graphify-related repository neighbors. No source diff and no call path from REPL activity reporting. |
| `scripts/codex-pty-shim.py`, `public/modules/core/terminal-transport-client.js` | Explicitly protected out of scope. Verified by protected-path diff command. |
| Live Feed UI/docs/tests (`public/modules/ui/views/live-feed-view.js`, `public/style.css`, `tests/ui/views/live-feed-view.test.js`, `docs/*live-feed-current-session-scope*`, `tests/e2e/story-live-feed-current-session-scope-contract.spec.ts`) | Out of scope and absent from the rebased PR diff against `origin/develop`; earlier apparent changes came from a stale base, not this story commit. |

## Verification Boundary

- Pre-merge verification covers the REPL contract, helper behavior, existing server-side session-state contract, typecheck, syntax, whitespace, and protected terminal/xterm diff.
- The HTTP failure warning path is covered by a unit test for one warning per endpoint/method and by REPL contract checks that non-OK HTTP responses route through that warning helper.
- Pre-merge verification does not claim that launchd port `31013` is already running this branch.
- Post-merge release verification must check `/api/version`, `/api/sessions/status`, `/api/state`, and the browser row state on port `31013` before saying the live runtime reflects the fix.
