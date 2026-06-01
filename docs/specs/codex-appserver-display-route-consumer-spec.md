# Spec: Codex App Server display route consumer

## Clauses

- `display-route-consumer.codex-app-server`: For `engine === "codex"` sessions with `displayRoute.mode === "codex_app_server"`, `switchSession()` MAY show the native App Server transcript panel by default when `story-codex-appserver-transcript-ui` is present.
- `display-route-consumer.codex-app-server-fallback`: xterm/ttyd MUST remain available through explicit terminal transport fallback and automatic unsupported, stale, failed transcript, and mobile fallback paths.
- `display-route-consumer.ui-wiring`: The same slice MUST include mixin registration in `public/app.js`, panel markup in `public/index.html`, and panel styling in `public/style.css`; otherwise the display route is not reachable or inspectable.
- `display-route-consumer.no-terminal-start`: Successful App Server transcript display sessions MUST NOT resolve or ensure terminal runtime during the display switch.
- `display-route-consumer.metadata-visible`: The display panel MUST expose the Brainbase session id and Codex App Server thread id in DOM text or data attributes.
- `display-route-consumer.read-only-controls`: App Server transcript display sessions MUST NOT let legacy terminal status, click-to-focus, or type-to-focus controls send terminal input while the panel is active; explicit xterm/ttyd transport selection MAY start terminal fallback.
- `display-route-consumer.claude-fallback`: Claude Code sessions MUST continue through the terminal display route.
- `display-route-consumer.codex-missing-fallback`: Codex sessions without usable App Server metadata MUST continue through the terminal display route.
- `display-route-consumer.mobile-unchanged`: Mobile switching MUST continue to use the existing snapshot behavior in this slice.
- `display-route-consumer.terminal-fallback-preserved`: The implementation MUST keep xterm/ttyd fallback code paths present and covered by tests.
- `display-route-consumer.graphify-impact-review`: Graphify Impact Review MUST be recorded because the route consumer touches graph-sensitive `session-ui-state` and session switching UI state paths.

## Evidence

- Story: `docs/stories/story-codex-appserver-display-route-consumer.md`
- Architecture: `docs/architecture/codex-appserver-display-route-consumer-architecture.md`
- Code: `public/modules/app/codex-app-server-display-mixin.js`, `public/modules/app/session-management-mixin.js`, `public/modules/app/terminal-display-mixin.js`, `public/modules/app/terminal-switch-mixin.js`, `public/app.js`, `public/index.html`, `public/style.css`
- Tests: `tests/ui/integration/app-switch-session-runtime.test.js`, `tests/e2e/story-codex-appserver-display-route-consumer-contract.spec.ts`
