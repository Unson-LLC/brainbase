# ADR: Codex App Server xterm default fallback

## Context

Codex App Server sessions now persist thread metadata and derive a `codex_app_server` display route. The display route consumer used that route to replace the terminal stage with a read-only panel. Because the panel has no input or transcript support, the route made new Codex sessions non-operable from the browser.

## Decision

Keep the App Server route metadata intact, but do not let it take over the user-facing terminal stage by default. `_shouldUseCodexAppServerDisplay()` now requires an explicit diagnostic browser flag before showing the read-only App Server panel. Without that flag, the normal desktop xterm path runs and the session remains interactive.

## Consequences

- App Server thread metadata remains available for activity, restore, and future native UI work.
- Operators keep the current xterm/ttyd input path for new and existing Codex sessions.
- The read-only panel remains testable as a diagnostic route without becoming the default experience.
- A future transcript/input Story can remove or replace this diagnostic opt-in once browser-side App Server interaction exists.

## Verification

- `npm run test:run -- tests/ui/integration/app-switch-session-runtime.test.js`
- `BRAINBASE_E2E_PORT=31018 npm run test:e2e -- tests/e2e/story-codex-appserver-xterm-default-fallback-contract.spec.ts tests/e2e/story-codex-appserver-display-route-consumer-contract.spec.ts tests/e2e/story-codex-appserver-metadata-timeout-contract.spec.ts tests/e2e/story-codex-appserver-session-create-contract.spec.ts`
