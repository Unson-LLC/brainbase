---
story_id: story-session-shell-first-startup-ux
title: Session shell-first startup UX
source_requirement:
  type: user_report
  description: Creating a Codex or Claude Code session can block the user in the create-session flow for about a minute before they can type the first prompt.
architecture_docs:
  - path: docs/brainbase-capabilities/capabilities/session.create.yml
    status: referenced
    reason: Session creation owns the modal, project, engine, initial command, and worktree setup flow.
  - path: docs/brainbase-capabilities/capabilities/terminal.transport.yml
    status: referenced
    reason: The first prompt must not be sent until terminal input transport is actually available.
related_tasks:
  - task_source: VibePro
    task_ids: [story-session-shell-first-startup-ux]
status: active
created_at: 2026-05-20
updated_at: 2026-05-20
---

# Session shell-first startup UX

## Background

Brainbase currently treats session creation, worktree creation, terminal runtime startup, and first prompt availability as one blocking operation. For Codex and Claude Code worktree sessions this can keep the user in a waiting flow for roughly a minute, even though the user already knows what they want to ask.

## Scope

- Create and display a session shell immediately after the user confirms the modal.
- Close the modal and navigate to the new session before worktree/runtime startup completes.
- Show a startup state in the terminal surface instead of a blocking progress modal.
- Let the user type or edit the first prompt while the workspace and agent are starting.
- Queue the first prompt and flush it only after the runtime startup request succeeds.
- Keep pending sessions from accidentally starting a terminal against the canonical repo path.
- Preserve the startup prompt draft/queue across browser refresh while the shell is pending or failed.
- Avoid reissuing worktree creation for the same pending shell during reload or session switch.
- Wait for failed worktree startup cleanup before exposing retry.
- Preserve existing session list filtering semantics (`sessionFilter` and archived visibility) while adding pending/failed startup shells.

## Acceptance Criteria

- [x] Creating a worktree-backed session returns the user to the terminal surface immediately with the new session selected.
- [x] The startup surface contains an editable first-prompt composer while workspace/runtime startup is pending.
- [x] Pressing send during startup queues the prompt instead of calling terminal input APIs immediately.
- [x] When startup completes, the queued prompt is sent exactly once through the normal terminal input service.
- [x] If startup fails, the prompt remains visible and retryable; it is not silently lost.
- [x] Pending shell sessions do not trigger `terminal/ensure`, xterm connection, ttyd iframe navigation, or snapshot loading against the canonical project path.
- [x] Unit tests cover shell-first creation, queued prompt behavior, and pending-session terminal switch blocking.

## Reliability Criteria

- [x] Reloading or switching back to a persisted pending shell does not issue a second worktree creation request for the same session id.
- [x] A queued startup prompt is restored after browser refresh while the shell remains pending.
- [x] If ttyd startup fails after worktree persistence, the failure response waits for worktree cleanup before retry can proceed.
- [x] Existing session search and archived filtering continue to control visible sessions and next-session selection.

## Verification

```bash
vibepro story diagnose . --id story-session-shell-first-startup-ux --run-graphify
npm test -- tests/ui/session-creation-mixin.test.js tests/domain/session/session-service.test.js tests/ui/integration/app-switch-session-runtime.test.js
npm run typecheck
BRAINBASE_E2E_PORT=31016 BRAINBASE_PORT=31016 PORT=31016 npm run test:e2e -- tests/e2e/story-session-shell-first-startup-ux.spec.js --project=chromium
```
