# ADR: Codex App Server assistant-ui native adoption

## Context

The previous polish slice used assistant-ui runtime and primitive wrappers, but Brainbase still owned the visible message implementation through custom `MessageBubble`, `RichMessageContent`, handwritten Markdown parsing, code copy, and activity row components. That contradicted the desired direction: first adopt the OSS assistant-ui experience as-is, then add Brainbase-specific extensions only where the product needs them.

## Decision

Use `@assistant-ui/react-ui` as the transcript's primary rendered UI:

- `AssistantRuntimeProvider` and `useExternalStoreRuntime` remain the adapter between Brainbase transcript snapshots and assistant-ui runtime state.
- The visible conversation surface is the pre-styled OSS `Thread` component from `@assistant-ui/react-ui`.
- Markdown rendering is delegated to `makeMarkdownText()` from `@assistant-ui/react-ui`, backed by `@assistant-ui/react-markdown`.
- The assistant-ui distributed CSS is imported as text and injected inside the island bundle so the existing non-React Brainbase shell does not need a new global stylesheet loader.
- Brainbase keeps only the outer header/context/status/error shell, App Server API functions, polling, mount lifecycle, and fallback behavior.

## Boundaries

- Browser network contract remains `GET /api/sessions/:id/codex-app-server/transcript` and `POST /api/sessions/:id/codex-app-server/turns`.
- The Brainbase shell remains non-React outside this island.
- `@assistant-ui/react-ui` and `@assistant-ui/react-markdown` are development dependencies used to build the committed browser bundle.
- Production Node dependency audit scope is unchanged; verify with `npm audit --omit=dev`.

## Tradeoffs

Some Codex-specific activity kinds no longer have bespoke compact rows in this slice. They are converted into assistant text messages with a small label. That is intentional for the native-adoption Story: custom event parts should be introduced only after the OSS thread is the baseline.

## Verification

- `npm run build:codex-appserver-transcript`
- `npm audit --omit=dev`
- `npm run test:e2e -- tests/e2e/story-codex-appserver-assistant-ui-native-adoption-contract.spec.ts`
