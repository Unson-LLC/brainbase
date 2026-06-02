# Codex App Server ChatGPT-like assistant-ui polish

## Story

As a Brainbase user working in a Codex App Server-backed session, I want the transcript panel to feel like a polished ChatGPT-style assistant thread, so I can read assistant output, code, tool activity, and follow-up prompts without the current debug-log feel.

## Acceptance Criteria

- The transcript island uses assistant-ui runtime, thread, message, and composer primitives for the primary chat surface instead of treating assistant-ui as only a wrapper.
- Assistant and user messages render as a centered, readable conversation with ChatGPT-like spacing, restrained chrome, and no debug-only labels in normal message bubbles.
- Markdown-style text, fenced code blocks, inline code, lists, and links render as structured React content without injecting HTML.
- Code blocks include a visible language label when present and a copy action that writes the code body to the clipboard.
- Reasoning, command, tool, file change, input request, turn, and error events render as compact activity rows with distinct icons, status labels, and expandable details where long content would otherwise dominate the thread.
- The composer supports ChatGPT-like keyboard behavior: Enter sends, Shift+Enter inserts a newline, the send button remains accessible, and empty sends are blocked.
- Loading, empty, sending, refresh, and API error states remain explicit and visually integrated with the thread.
- The existing Brainbase App Server transcript and turn APIs remain the only browser network contract; terminal input remains disabled in transcript mode.
- xterm/ttyd fallback, mobile fallback, Claude Code terminal routing, and the existing failed-island fallback stay intact.
- The browser bundle builds from `@assistant-ui/react` and the capability map records the polished assistant-ui surface.

## Out Of Scope

- Server-side streaming transport changes.
- Replacing the full Brainbase shell with React.
- Removing terminal fallback or changing Claude Code terminal behavior.
- Persisting full transcript history outside the existing bounded session ledger.
