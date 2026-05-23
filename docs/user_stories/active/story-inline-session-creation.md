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
updated_at: 2026-05-22
---

# story-inline-session-creation: Remove the create-session modal and configure new sessions in the startup shell

## Background

Brainbase currently opens a create-session modal before creating a new session. The modal asks for session name, project, initial command, AI engine, and JJ workspace usage.

After `story-session-shell-first-startup-ux`, worktree sessions already show a pending startup shell immediately after creation. That makes the modal and the pending shell feel like two screens for the same job.

The expected flow is: clicking `新規セッション` immediately opens a new session surface, and the user configures project, engine, workspace, name, and initial input there.

## Current PR Requirements

- Record the product requirement that `新規セッション` should eventually avoid `#create-session-modal` on the primary path.
- Record the implementation contract for a future inline draft shell without changing the current new-session UI in this PR.
- Keep the future implementation bounded to the existing session creation UI, session service, state store, and terminal startup architecture.
- Make the existing Mana Lambda chat URL construction explicit without changing `/chat` request or response semantics.
- Make the existing `pause-orphan-tmux-missing-sessions.js` Brainbase health/state URL construction explicit and preserve `--session` filtering before PATCHing `/api/state/sessions/:id`.

## Architecture Decision

ADR is not required for this planning PR. The intended implementation stays inside the existing session creation UI, session service, state store, and terminal startup boundaries documented in `docs/architecture/terminal-runtime-architecture.md`. It does not introduce a new service boundary, persistence model, authentication boundary, or runtime protocol.

The only runtime code change in this PR is a Network Contract cleanup for existing maintenance/API calls: external Mana Lambda chat URL construction and Brainbase terminal health/state URLs are made explicit without changing request semantics.

## Acceptance Criteria

- [ ] The Story records why the create-session modal should be removed from the primary new-session flow.
- [ ] The Spec defines the inline draft shell invariants, runtime-start boundary, cancel behavior, and mobile/desktop shared state machine.
- [ ] The PR keeps the actual inline implementation as follow-up work and does not claim the modal has already been removed.
- [ ] Existing Network Contract cleanup is explicit: Mana Lambda chat and Brainbase terminal health/state calls are built through URL helpers without changing request semantics.
- [ ] Existing tmux-missing cleanup behavior remains unchanged: without `--session` every `tmux_missing` health issue is eligible, and with `--session` only listed IDs are patched.
- [ ] Current UI journeys are explicitly non-applicable for this PR because no public UI source changes; existing modal behavior remains current until the follow-up implementation PR.

## Follow-up Implementation Notes

The follow-up implementation should cover these behaviors, but this PR does not implement or verify them yet:
desktop add-session modal suppression; draft row selection before startup; editable project/engine/workspace/name/prompt controls; project-driven workspace availability; no-repository disabled workspace explanation; worktree confirmation through `createPendingSessionShell`; non-worktree confirmation through the existing regular creation flow; draft cancel restore; pending startup composer queue/flush/retry/reload; mobile and desktop entrypoints sharing one inline state machine.

The follow-up implementation must also update agent-facing capability artifacts that currently name `#create-session-modal`, especially `docs/brainbase-capabilities/capabilities/session.create.yml` and `docs/brainbase-capabilities/capabilities/project.selector.yml`.

## Verification

```bash
npm test -- --run tests/server/routes/mana-capture-routes.test.js tests/server/scripts/pause-orphan-tmux-missing-sessions.test.js tests/server/routes/health.test.js tests/server/controllers/health-controller.test.js
npx playwright test tests/e2e/story-inline-session-creation-pr-gate.spec.ts --project=chromium
npm run typecheck
vibepro check ui . --story-id story-inline-session-creation
vibepro pr prepare . --base origin/develop --story-id story-inline-session-creation
```
