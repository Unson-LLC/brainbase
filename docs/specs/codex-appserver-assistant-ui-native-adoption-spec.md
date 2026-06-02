# Spec: Codex App Server assistant-ui native adoption

## Clauses

- `codex-appserver-assistant-ui-native-adoption.oss-thread`: The transcript island MUST render the primary chat surface with `Thread` from `@assistant-ui/react-ui`.
- `codex-appserver-assistant-ui-native-adoption.adapter-only`: Brainbase-specific React code MUST stay limited to transcript snapshot normalization, turn submission, status/error display, and shell mount integration.
- `codex-appserver-assistant-ui-native-adoption.no-custom-primary-renderer`: The primary transcript path MUST NOT define or use `MessageBubble`, `RichMessageContent`, handwritten `MarkdownText`, or `ActivityEvent`.
- `codex-appserver-assistant-ui-native-adoption.markdown`: Markdown message content MUST use assistant-ui OSS markdown integration through `makeMarkdownText()`.
- `codex-appserver-assistant-ui-native-adoption.css`: The island bundle MUST include assistant-ui distributed `styles/index.css` and `styles/markdown.css` for `aui-*` component classes.
- `codex-appserver-assistant-ui-native-adoption.api-boundary`: Browser turns MUST go through the existing App Server turn API and MUST NOT send terminal input in transcript mode.
- `codex-appserver-assistant-ui-native-adoption.fallback`: xterm/ttyd fallback, mobile fallback, Claude Code terminal routing, and failed-island fallback MUST remain covered by existing tests.
- `codex-appserver-assistant-ui-native-adoption.dependency-scope`: assistant-ui UI and markdown packages MUST remain build-time scoped dev dependencies unless a later gate accepts production dependency expansion.

## Traceability

- Story: `docs/stories/story-codex-appserver-assistant-ui-native-adoption.md`
- Architecture: `docs/architecture/codex-appserver-assistant-ui-native-adoption-architecture.md`
- Island: `ui-islands/codex-appserver-transcript/index.jsx`
- Build: `package.json` script `build:codex-appserver-transcript`
- Tests: `tests/e2e/story-codex-appserver-assistant-ui-native-adoption-contract.spec.ts`
