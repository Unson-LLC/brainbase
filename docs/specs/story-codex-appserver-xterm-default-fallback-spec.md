# Spec: Codex App Server xterm default fallback

## Clauses

- `codex-appserver-xterm-default.route-preserved`: `deriveSessionDisplayRoute()` MAY still return `codex_app_server` for Codex sessions with non-stale App Server thread metadata.
- `codex-appserver-xterm-default.default-xterm`: Browser session switching MUST NOT show the App Server display panel by default for App Server-backed Codex sessions; it MUST continue through the interactive xterm/ttyd path.
- `codex-appserver-xterm-default.diagnostic-opt-in`: Browser session switching MAY show the read-only App Server display panel only when `window.__BRAINBASE_ENABLE_CODEX_APP_SERVER_DISPLAY__ === true`.
- `codex-appserver-xterm-default.read-only-panel`: When the diagnostic App Server panel is active, legacy terminal input, paste, key, reconnect, click-to-focus, and type-to-focus controls MUST NOT send terminal input or start terminal runtime.
- `codex-appserver-xterm-default.metadata-create`: Regular and worktree Codex session creation MUST continue to request App Server startup and persist non-stale thread metadata.
- `codex-appserver-xterm-default.fallbacks`: Claude Code sessions, Codex sessions with missing metadata, and Codex sessions with stale metadata MUST keep the existing terminal fallback path.

## Evidence

- Story: `docs/stories/story-codex-appserver-xterm-default-fallback.md`
- Architecture: `docs/architecture/story-codex-appserver-xterm-default-fallback-architecture.md`
- Code: `public/modules/app/codex-app-server-display-mixin.js`, `public/modules/app/session-management-mixin.js`
- Tests: `tests/ui/integration/app-switch-session-runtime.test.js`, `tests/e2e/story-codex-appserver-xterm-default-fallback-contract.spec.ts`, `tests/e2e/story-codex-appserver-display-route-consumer-contract.spec.ts`, `tests/e2e/story-codex-appserver-session-create-contract.spec.ts`
