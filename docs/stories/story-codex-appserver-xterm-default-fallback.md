# Codex App Server xterm default fallback

## Story

As a Brainbase user operating a Codex session, I want Codex App Server metadata to remain recoverable through xterm/ttyd fallback, so App Server-backed sessions stay usable even after the native transcript and input UI becomes the default.

## Background

The Codex App Server route consumer originally exposed a read-only metadata panel for sessions with `session.codexAppServer.threadId`. That proved the route and metadata path, but it hid xterm and left the operator with no input path. `story-codex-appserver-transcript-ui` supersedes the old default-xterm constraint by adding a native transcript/composer path. The surviving contract is that xterm/ttyd fallback remains explicit and recoverable.

## Acceptance Criteria

- Codex sessions with non-stale `session.codexAppServer.threadId` may default to the native transcript panel when `story-codex-appserver-transcript-ui` is present.
- xterm/ttyd remains available through explicit fallback actions and unsupported, stale, or failed App Server transcript paths.
- When the App Server transcript panel is active, legacy terminal input remains read-only unless the user explicitly switches to xterm/ttyd fallback.
- New regular and worktree Codex session creation still persists App Server thread metadata.
- Claude Code sessions and Codex sessions without usable App Server metadata continue to use the existing terminal fallback path.
- Capability, Story, Architecture, Spec, and contract tests consistently describe transcript default plus xterm/ttyd fallback behavior.

## Out Of Scope

- Removing xterm/ttyd fallback.
