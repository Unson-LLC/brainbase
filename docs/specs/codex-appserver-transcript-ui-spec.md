# Spec: Codex App Server transcript UI

## Clauses

- `codex-appserver-transcript-ui.default-display`: App Server-backed Codex sessions SHOULD use the native transcript display when the server App Server control path is ready.
- `codex-appserver-transcript-ui.structured-events`: The transcript renderer MUST consume App Server notifications and MUST NOT parse terminal text.
- `codex-appserver-transcript-ui.required-ui-wiring`: The transcript UI slice MUST include browser registration, HTML host, CSS, and capability-map updates needed for the route to be reachable, visible, styled, and documented.
- `codex-appserver-transcript-ui.browser-input`: Browser input in transcript mode MUST call a Brainbase App Server turn API and MUST NOT post to ttyd/xterm terminal input.
- `codex-appserver-transcript-ui.timeline-items`: The timeline MUST distinguish user messages, assistant deltas, reasoning summaries, command output, file changes, tool/input requests, errors, and completion state.
- `codex-appserver-transcript-ui.error-visible`: App Server `error` notifications and failed browser turn starts MUST be recorded in the server ledger and rendered as visible transcript errors after refresh.
- `codex-appserver-transcript-ui.ledger`: Brainbase MUST maintain a bounded session-owned transcript ledger sufficient for active restore and display.
- `codex-appserver-transcript-ui.lifecycle-cleanup`: Stop, hibernate, and archive flows MUST dispose any cached transcript-owned App Server adapter for the affected Brainbase session.
- `codex-appserver-transcript-ui.policy-preservation`: Browser turn submission MUST NOT hardcode approval or sandbox escalation policy; explicit session metadata may be passed through when present.
- `codex-appserver-transcript-ui.no-graph-raw-events`: Raw App Server transcript events MUST NOT be written into Graph SSOT.
- `codex-appserver-transcript-ui.restore`: Switching back to an App Server transcript session MUST request the latest bounded transcript state and render it into the selected session panel.
- `codex-appserver-transcript-ui.fallback`: xterm/ttyd fallback MUST remain available for unsupported sessions, stale metadata, App Server control failure, and explicit user recovery.
- `codex-appserver-transcript-ui.claude-unmodified`: Claude Code sessions MUST continue through the existing terminal path.
- `codex-appserver-transcript-ui.mobile-contract`: Mobile behavior MUST either support the transcript composer or present an explicit fallback reason.
- `codex-appserver-transcript-ui.assistant-ui-island`: The polished desktop transcript surface MAY be implemented as an assistant-ui React island as long as the App Server API boundary and terminal fallback clauses above remain intact.

## Evidence

- Story: `docs/stories/story-codex-appserver-transcript-ui.md`
- Architecture: `docs/architecture/codex-appserver-transcript-ui-architecture.md`
- Capability: `docs/brainbase-capabilities/capabilities/codex.app-server.yml`
- Code: `server/services/codex-app-server-transcript-service.js`, `server/routes/sessions.js`, `public/modules/app/codex-app-server-display-mixin.js`, `public/index.html`, `public/style.css`
- Tests: `tests/server/services/codex-app-server-transcript-service.test.js`, `tests/server/codex-app-server-transcript-routes.test.js`, `tests/ui/integration/app-switch-session-runtime.test.js`
- Runtime smoke: `tests/e2e/story-codex-appserver-transcript-ui-contract.spec.ts` exercises browser `switchSession`, transcript GET, composer POST, visible errors, and asserts terminal input/ensure APIs are not called.
- assistant-ui island: `ui-islands/codex-appserver-transcript/index.jsx`
- Optional operational smoke: port 31013 can still be used after merge to check a live Codex CLI adapter, but it is not the only contract evidence.
