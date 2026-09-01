---
story_id: story-session-launch-picker-startup-composer
title: Retired Brainbase Session Launch Picker and Startup Composer
source_requirement:
  type: user_report
  description: 新規セッション開始時の旧Brainbaseブラウザ導線。
related_stories:
  - story-inline-session-creation
  - story-session-shell-first-startup-ux
status: retired
retired_reason: Codex app/CLI now owns task and worktree creation, while Brainbase session APIs return 410 Gone.
created_at: 2026-05-26
updated_at: 2026-09-01
---

# Retired: Brainbase Session Launch Picker and Startup Composer

## Historical behavior

The browser previously opened a Session Launch Picker for project, engine, and
Git worktree settings, then used Startup Composer while Brainbase created the
session in the background.

## Current ownership boundary

- Codex app/CLI owns new task and worktree creation.
- Brainbase `/api/sessions` creation endpoints are retired and return `410 Gone`.
- `EVENTS.CREATE_SESSION` must show a migration notice and must not open the
  legacy picker or call a retired session API.
- `#session-launch-picker` and its implementation are frozen historical
  compatibility code and unreachable. During migration, the old NocoDB
  `START_TASK` path may still show FocusEngineModal; choosing an engine must
  immediately fail closed to the Codex
  migration notice without calling a session API.
- Workspace Setup may still consume the authenticated Project Catalog through
  `#session-project-select`; it does not create projects, tasks, or sessions.
- Formal project registration uses Project Provisioning Skill/CLI/API/MCP.

## Retirement acceptance criteria

- [ ] Desktop and mobile create-session events cannot reach the legacy picker.
- [ ] NocoDB task start may show FocusEngineModal, but engine selection
      reaches the Codex migration notice without calling `/api/sessions`.
- [ ] The user is directed to create a new task in the Codex app.
- [ ] The retired capability owns the historical picker/API surfaces.
- [ ] Workspace Setup remains a read-only downstream Project Catalog consumer.
