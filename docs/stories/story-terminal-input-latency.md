---
story_id: story-terminal-input-latency
title: Terminal input latency improvement
status: in_progress
created_at: 2026-05-18
updated_at: 2026-05-18
related_specs:
  - docs/specs/story-terminal-input-latency-spec.md
reason: Existing TerminalTransportClient local echo architecture is unchanged; this story only narrows client-side rendering for pending ASCII Backspace.
architecture_docs:
  - docs/architecture/terminal-runtime-architecture.md
  - docs/architecture/ADR-terminal-history-scrollback.md
---

# Story: Terminal input latency improvement

## Background

Brainbase terminal input already uses local echo for printable text so users do
not wait for the WebSocket, tmux, and snapshot loop before seeing typed
characters. Backspace still waited for the remote PTY echo, which made deletion
feel slower than insertion in Codex and Claude Code sessions.

## User Story

As a Brainbase terminal user, when I delete recently typed text I want the
visible character to disappear immediately while the Backspace is still sent to
the runtime, so that editing latency stays consistent with normal typing.

## Acceptance Criteria

- Backspace locally erases a pending single-cell ASCII character that was optimistically echoed but not yet confirmed by server output.
- Backspace is still sent through the WebSocket terminal input path.
- When there is no pending local echo, Backspace rendering remains PTY-driven.
- Non-ASCII pending echo is not locally erased, because wide-cell deletion can corrupt terminal display.
- Unit coverage proves the local erase, PTY fallback, non-ASCII guard, and terminal input send behavior.
- VibePro evidence records a client marker for the local erase path.

## Non-goals

- Do not change tmux Backspace handling.
- Do not change server terminal transport protocol.
- Do not locally erase historical PTY output that was not created by local echo.
