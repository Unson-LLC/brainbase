---
story_id: story-inline-session-creation
title: Retired Brainbase inline session creation
source_requirement:
  type: user_report
  description: 旧Brainbaseブラウザでセッション作成モーダルを減らす要望。
status: retired
retired_reason: Codex app/CLI now owns task and worktree creation, while Brainbase session creation APIs return 410 Gone.
created_at: 2026-05-22
updated_at: 2026-09-01
---

# Retired: Brainbase inline session creation

The inline draft was designed to collect project, engine, workspace, session
name, and initial input before calling the Brainbase session creation path.
That ownership moved to Codex app/CLI.

Current behavior:

- `EVENTS.CREATE_SESSION` shows a Codex migration notice.
- It does not open an inline draft, launch picker, or create-session modal.
- It does not call `/api/sessions`, `/api/sessions/start`, or
  `/api/sessions/create-with-worktree`.
- Historical DOM and mixin methods may remain temporarily for compatibility,
  but they are not reachable product entrypoints.
