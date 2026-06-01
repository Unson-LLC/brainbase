# ADR: Codex App Server xterm default fallback

## Context

Codex App Server sessions now persist thread metadata and derive a `codex_app_server` display route. The display route consumer used that route to replace the terminal stage with a read-only panel. Because the panel has no input or transcript support, the route made new Codex sessions non-operable from the browser.

## Decision

Keep the App Server route metadata intact and keep xterm/ttyd as an explicit fallback path. `story-codex-appserver-transcript-ui` now provides the user-facing App Server transcript/composer default. `_shouldUseCodexAppServerDisplay()` may select that transcript path, but session switching must fall back to xterm/ttyd when metadata is stale, unsupported, mobile snapshot mode is required, transcript loading fails, or the user explicitly selects terminal fallback.

## Consequences

- App Server thread metadata remains available for activity, restore, and future native UI work.
- Operators can still recover through xterm/ttyd for new and existing Codex sessions.
- The old read-only diagnostic panel is superseded by the structured transcript panel.
- Terminal fallback controls must not be exposed as no-op controls while the App Server transcript panel is active.

## Verification

- `npm run test:run -- tests/ui/integration/app-switch-session-runtime.test.js`
- `BRAINBASE_E2E_PORT=31018 npm run test:e2e -- tests/e2e/story-codex-appserver-xterm-default-fallback-contract.spec.ts tests/e2e/story-codex-appserver-display-route-consumer-contract.spec.ts tests/e2e/story-codex-appserver-metadata-timeout-contract.spec.ts tests/e2e/story-codex-appserver-session-create-contract.spec.ts`
