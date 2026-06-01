# Spec: Codex App Server xterm default fallback

## Clauses

- `codex-appserver-xterm-default.route-preserved`: `deriveSessionDisplayRoute()` MAY still return `codex_app_server` for Codex sessions with non-stale App Server thread metadata.
- `codex-appserver-xterm-default.transcript-default-supersedes`: Browser session switching MAY show the native App Server transcript panel by default for App Server-backed Codex sessions when `story-codex-appserver-transcript-ui` is present.
- `codex-appserver-xterm-default.explicit-terminal-fallback`: Browser session switching MUST keep xterm/ttyd available for unsupported sessions, stale App Server metadata, transcript load failure, mobile fallback, and explicit terminal transport selection.
- `codex-appserver-xterm-default.read-only-panel`: When the App Server transcript panel is active, legacy terminal input, paste, key, click-to-focus, and type-to-focus controls MUST NOT send terminal input unless the user first switches to xterm/ttyd fallback.
- `codex-appserver-xterm-default.metadata-create`: Regular and worktree Codex session creation MUST continue to request App Server startup and persist non-stale thread metadata.
- `codex-appserver-xterm-default.fallbacks`: Claude Code sessions, Codex sessions with missing metadata, and Codex sessions with stale metadata MUST keep the existing terminal fallback path.

## Evidence

- Story: `docs/stories/story-codex-appserver-xterm-default-fallback.md`
- Architecture: `docs/architecture/story-codex-appserver-xterm-default-fallback-architecture.md`
- Code: `public/modules/app/codex-app-server-display-mixin.js`, `public/modules/app/session-management-mixin.js`
- Tests: `tests/ui/integration/app-switch-session-runtime.test.js`, `tests/e2e/story-codex-appserver-xterm-default-fallback-contract.spec.ts`, `tests/e2e/story-codex-appserver-display-route-consumer-contract.spec.ts`, `tests/e2e/story-codex-appserver-session-create-contract.spec.ts`
