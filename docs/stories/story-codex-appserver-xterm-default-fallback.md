# Codex App Server xterm default fallback

## Story

As a Brainbase user operating a Codex session, I want Codex App Server metadata to be available without replacing the interactive terminal, so a newly created App Server-backed Codex session remains usable until native App Server transcript and input are implemented.

## Background

The Codex App Server route consumer exposed a read-only metadata panel for sessions with `session.codexAppServer.threadId`. That proved the route and metadata path, but it hid xterm and left the operator with no input path. The capability record says this App Server slice must not replace xterm/tmux terminal transport yet.

## Acceptance Criteria

- Codex sessions with non-stale `session.codexAppServer.threadId` keep the xterm/ttyd display path by default.
- The read-only Codex App Server display panel is available only behind an explicit diagnostic browser opt-in.
- When the diagnostic panel is enabled, legacy terminal input and reconnect controls remain read-only and do not start terminal runtime.
- New regular and worktree Codex session creation still persists App Server thread metadata.
- Claude Code sessions and Codex sessions without usable App Server metadata continue to use the existing terminal fallback path.
- Capability, Story, Architecture, Spec, and contract tests consistently describe the same default xterm behavior.

## Out Of Scope

- Browser-side Codex App Server input.
- App Server transcript rendering.
- Removing xterm/ttyd fallback.
