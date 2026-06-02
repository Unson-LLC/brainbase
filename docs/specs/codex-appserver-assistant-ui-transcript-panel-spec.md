# Spec: Codex App Server assistant-ui transcript panel

## Clauses

- `codex-appserver-assistant-ui-transcript-panel.react-island`: The transcript panel MUST mount as an isolated React island and MUST NOT require converting the whole Brainbase shell to React.
- `codex-appserver-assistant-ui-transcript-panel.assistant-ui`: The island MUST use assistant-ui runtime, thread, and composer primitives for the transcript surface.
- `codex-appserver-assistant-ui-transcript-panel.api-boundary`: The island MUST receive Brainbase API functions from the shell and MUST submit turns through the existing App Server turn API.
- `codex-appserver-assistant-ui-transcript-panel.structured-kinds`: The renderer MUST preserve distinct visual treatment for user, assistant, reasoning, command, file change, tool, input request, turn, and error timeline kinds.
- `codex-appserver-assistant-ui-transcript-panel.text-safe`: Transcript event text MUST be rendered as React text content, not injected HTML.
- `codex-appserver-assistant-ui-transcript-panel.states`: Loading, empty, refresh, sending, and API error states MUST be visible and actionable.
- `codex-appserver-assistant-ui-transcript-panel.fallback`: xterm/ttyd fallback and Claude Code terminal behavior MUST remain unchanged.
- `codex-appserver-assistant-ui-transcript-panel.mount-guard`: If the React mount root or session id is unavailable, the shell MUST not partially mount the island and MUST preserve the existing terminal/fallback surface.
- `codex-appserver-assistant-ui-transcript-panel.import-retry`: If the island dynamic import or mount fails, the shell MUST retry once with a cache-busted island URL before using the existing fallback renderer.
- `codex-appserver-assistant-ui-transcript-panel.unique-message-ids`: The island MUST provide assistant-ui with unique message ids even when the Brainbase transcript ledger contains duplicate event ids.
- `codex-appserver-assistant-ui-transcript-panel.dependency-scope`: assistant-ui MUST remain build-time scoped for this slice unless a later dependency gate explicitly accepts production runtime dependency expansion.

## Evidence

- Story: `docs/stories/story-codex-appserver-assistant-ui-transcript-panel.md`
- Architecture: `docs/architecture/codex-appserver-assistant-ui-transcript-panel-architecture.md`
- Code: `ui-islands/codex-appserver-transcript/index.jsx`, `public/modules/app/codex-app-server-display-mixin.js`, `public/index.html`, `public/style.css`
- Bundle: `public/dist/codex-appserver-transcript-island.js`
- Tests: `tests/e2e/story-codex-appserver-assistant-ui-transcript-panel-contract.spec.ts`, `tests/e2e/story-codex-appserver-transcript-ui-contract.spec.ts`
