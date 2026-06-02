# Codex App Server assistant-ui native adoption

## User Story

As a Brainbase user working in a Codex App Server-backed session, I want Brainbase to adopt the OSS assistant-ui pre-styled chat thread as the default transcript experience first, so the screen behaves like a real assistant conversation instead of a custom Brainbase renderer that only wraps assistant-ui primitives.

## Acceptance Criteria

- The transcript island imports and renders the pre-styled OSS `@assistant-ui/react-ui` `Thread` as the primary chat surface.
- Brainbase-specific code is limited to the Codex App Server transcript/turn adapter, outer shell metadata, visible status/error state, and mount/fallback integration.
- The island removes custom primary message renderers such as `MessageBubble`, `RichMessageContent`, `MarkdownText`, and `ActivityEvent`.
- Markdown rendering uses assistant-ui OSS markdown integration, not a Brainbase handwritten parser.
- The assistant-ui distributed CSS is bundled into the island and injected for the `aui-*` component classes.
- Browser input still posts only to `POST /api/sessions/:id/codex-app-server/turns`; terminal input remains disabled in transcript mode.
- xterm/ttyd fallback, mobile fallback, Claude Code terminal routing, and failed-island fallback remain unchanged.
- `@assistant-ui/react-ui` and `@assistant-ui/react-markdown` remain development dependencies for the browser bundle and do not expand production Node dependency audit scope.

## Non-Goals

- This Story does not implement server-side streaming.
- This Story does not create a custom ChatGPT clone renderer.
- This Story does not preserve every Brainbase activity event as a bespoke row; non-chat timeline kinds are adapted into assistant messages until a later assistant-ui-native tool/event-part Story defines that behavior.
