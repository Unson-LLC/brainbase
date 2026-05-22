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

## Requirements

- `新規セッション` must not open `#create-session-modal` on the primary path.
- Brainbase must create/select an inline draft session shell immediately.
- The inline shell must provide session name, project, AI engine, JJ workspace, initial input, start, and cancel controls.
- Runtime, ttyd, xterm, snapshot loading, and worktree creation must not start before the user confirms settings.
- Confirming a worktree draft must reuse the existing pending-shell/background startup flow.
- Confirming a regular draft must reuse the existing non-worktree creation flow.
- Canceling an unconfirmed draft must remove only that draft and restore the previous current session when possible.
- Startup prompt queueing, retry, failure preservation, and reload recovery from `story-session-shell-first-startup-ux` must remain intact.
- Mobile and desktop new-session entrypoints must share the same inline creation state machine.
- The existing `pause-orphan-tmux-missing-sessions.js` maintenance script may filter tmux-missing sessions by explicit `--session` IDs before PATCHing `/api/state/sessions/:id`; this is an operational cleanup path and is outside the inline creation runtime flow.

## Architecture Decision

ADR is not required for this planning PR. The intended implementation stays inside the existing session creation UI, session service, state store, and terminal startup boundaries documented in `docs/architecture/terminal-runtime-architecture.md`. It does not introduce a new service boundary, persistence model, authentication boundary, or runtime protocol.

The only runtime code change in this PR is a Network Contract cleanup for existing maintenance/API calls: external Mana Lambda chat URL construction and Brainbase terminal health/state URLs are made explicit without changing request semantics.

## Acceptance Criteria

- [ ] Desktop `#add-session-btn` does not activate `#create-session-modal`.
- [ ] A new session row is added and selected before slow worktree/runtime startup begins.
- [ ] The terminal area shows an inline creation shell with editable project, engine, workspace, name, and prompt controls.
- [ ] Project changes update workspace availability without starting runtime.
- [ ] Projects without a Git repository disable the workspace toggle with an inline reason.
- [ ] Worktree confirmation calls `createPendingSessionShell` before background `createSession`.
- [ ] Non-worktree confirmation uses the existing regular creation flow.
- [ ] Cancel removes the draft shell without mutating existing sessions.
- [ ] The existing pending startup composer still queues and flushes prompt text once after readiness.
- [ ] The updated E2E covers inline creation through pending startup and retry.
- [ ] Existing tmux-missing cleanup behavior remains unchanged: without `--session` every `tmux_missing` health issue is eligible, and with `--session` only listed IDs are patched.

## Verification

```bash
npm test -- tests/ui/session-creation-mixin.test.js
npm test -- tests/domain/session/session-service.test.js
npm test -- tests/ui/integration/app-switch-session-runtime.test.js
BRAINBASE_E2E_PORT=31016 BRAINBASE_PORT=31016 PORT=31016 npm run test:e2e -- tests/e2e/story-session-shell-first-startup-ux.spec.js --project=chromium
vibepro check ui . --story-id story-inline-session-creation
vibepro pr prepare . --base origin/develop --story-id story-inline-session-creation
```
