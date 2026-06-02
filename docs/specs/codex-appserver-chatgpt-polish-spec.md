# Spec: Codex App Server ChatGPT-like assistant-ui polish

## Clauses

- `codex-appserver-chatgpt-polish.assistant-ui-depth`: The island MUST use assistant-ui runtime, thread, message, and composer primitives for the primary chat surface.
- `codex-appserver-chatgpt-polish.conversation-layout`: User and assistant messages MUST render as a readable centered conversation and MUST NOT expose debug-only labels inside normal bubbles.
- `codex-appserver-chatgpt-polish.safe-markdown`: Markdown-style text, fenced code blocks, inline code, lists, and links MUST render as React nodes and MUST NOT use `dangerouslySetInnerHTML`.
- `codex-appserver-chatgpt-polish.copy-code`: Fenced code blocks MUST expose a copy action and MUST label the language when supplied.
- `codex-appserver-chatgpt-polish.activity-events`: Reasoning, command, tool, file change, input request, turn, and error timeline kinds MUST remain visually distinct and compact, with expandable long details.
- `codex-appserver-chatgpt-polish.composer-keyboard`: Enter MUST submit non-empty input, Shift+Enter MUST insert a newline, and the explicit send button MUST remain accessible.
- `codex-appserver-chatgpt-polish.states`: Loading, empty, sending, refresh, and API error states MUST remain visible and actionable.
- `codex-appserver-chatgpt-polish.api-boundary`: Browser turn submission MUST continue to use `POST /api/sessions/:id/codex-app-server/turns` and MUST NOT send terminal input in transcript mode.
- `codex-appserver-chatgpt-polish.fallback`: xterm/ttyd fallback, mobile fallback, Claude Code terminal routing, and failed-island fallback MUST remain intact.
- `codex-appserver-chatgpt-polish.bundle`: The committed browser bundle MUST be rebuilt from the updated island.

## Evidence

- Story: `docs/stories/story-codex-appserver-chatgpt-polish.md`
- Architecture: `docs/architecture/codex-appserver-chatgpt-polish-architecture.md`
- Code: `ui-islands/codex-appserver-transcript/index.jsx`, `public/style.css`, `public/modules/app/codex-app-server-display-mixin.js`
- Bundle: `public/dist/codex-appserver-transcript-island.js`
- Tests: `tests/e2e/story-codex-appserver-chatgpt-polish-contract.spec.ts`, `tests/e2e/story-codex-appserver-assistant-ui-transcript-panel-contract.spec.ts`
