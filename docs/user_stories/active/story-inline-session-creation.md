---
story_id: story-inline-session-creation
title: Remove the create-session modal and configure new sessions in the startup shell
source_requirement:
  type: user_report
  description: 新規セッション作成時のモーダルは、次の pending startup 画面で設定できる内容を先に聞いており、画面数と待ちを増やしている。
architecture_docs:
  - path: docs/architecture/terminal-runtime-architecture.md
    status: referenced
  reason: "既存の session creation UI、session service、state store、terminal startup 境界内の変更であり、新しいサービス境界・永続化モデル・認証境界・runtime protocol を追加しないため新規ADRは不要。"
related_stories:
  - story-session-shell-first-startup-ux
related_tasks:
  - task_source: VibePro
    task_ids: [story-inline-session-creation]
status: active
created_at: 2026-05-22
updated_at: 2026-05-23
---

# story-inline-session-creation: Remove the create-session modal and configure new sessions in the startup shell

## Background

Brainbase currently opens a create-session modal before creating a new session. The modal asks for session name, project, initial command, AI engine, and JJ workspace usage.

After `story-session-shell-first-startup-ux`, worktree sessions already show a pending startup shell immediately after creation. That makes the modal and the pending shell feel like two screens for the same job.

The expected flow is: clicking `新規セッション` immediately opens a new session surface, and the user configures project, engine, workspace, name, and initial input there.

## Current PR Requirements

- Remove `#create-session-modal` from the primary desktop and mobile new-session path.
- Show a client-owned inline draft shell in the terminal surface before session confirmation.
- Keep draft edits for session name, project, initial command, AI engine, and JJ workspace local until confirmation.
- Start runtime/worktree creation only after confirmation.
- Route worktree confirmations through the existing pending-shell and background startup path.
- Route non-worktree confirmations through the existing regular session creation path.
- Preserve cancel behavior: canceling the draft must not create, archive, delete, persist, or switch any real session.
- Update agent-facing capability artifacts so `#create-session-modal` is no longer the canonical creation surface.

## Architecture Decision

ADR is not required for this implementation PR. The implementation stays inside the existing session creation UI, session service, state store, and terminal startup boundaries documented in `docs/architecture/terminal-runtime-architecture.md`. It does not introduce a new service boundary, persistence model, authentication boundary, or runtime protocol.

## Acceptance Criteria

- [ ] Desktop `#add-session-btn` and mobile new-session entrypoints open the inline draft shell and do not add `.active` to `#create-session-modal`.
- [ ] The inline draft shell exposes editable project, engine, workspace, session name, and initial command controls.
- [ ] Opening and editing the inline draft does not call `SessionService.createSession()`, `createPendingSessionShell()`, runtime startup, or worktree creation before confirmation.
- [ ] Canceling the inline draft leaves the current session state unchanged.
- [ ] Confirming a worktree draft calls the existing pending-shell startup path; confirming a non-worktree draft calls the existing regular session creation path.
- [ ] Projects without a Git repository disable JJ workspace and show the reason inline.
- [ ] Capability artifacts no longer present `#create-session-modal` as the canonical session creation surface.

## Implementation Notes

The primary creation entrypoint now opens `#inline-session-draft` in the terminal surface. `openCreateSessionModal()` remains as a backward-compatible method name, but delegates to the inline draft instead of activating `#create-session-modal`.

The draft is DOM/client state only until the user presses 作成. Confirmation reuses the existing `createSession()` method, so the shell-first pending startup behavior and startup composer queue/flush/retry/reload semantics remain owned by the existing session creation path.

## Verification

```bash
npm test -- --run tests/server/routes/mana-capture-routes.test.js tests/server/scripts/pause-orphan-tmux-missing-sessions.test.js tests/server/routes/health.test.js tests/server/controllers/health-controller.test.js
npm test -- --run tests/ui/session-creation-mixin.test.js
npx playwright test tests/e2e/story-inline-session-creation-pr-gate.spec.ts --project=chromium
npm run typecheck
vibepro check ui . --story-id story-inline-session-creation
vibepro pr prepare . --base origin/develop --story-id story-inline-session-creation
```
