---
story_id: story-session-launch-picker-startup-composer
title: Split new session launch settings from startup input
source_requirement:
  type: user_report
  description: 新規セッション開始時は project / engine / Git worktree だけを先に確定し、待ち時間はStartup Composerで初回プロンプトを書きながら吸収する。
related_stories:
  - story-inline-session-creation
  - story-session-shell-first-startup-ux
status: active
created_at: 2026-05-26
updated_at: 2026-05-26
---

# story-session-launch-picker-startup-composer: Split new session launch settings from startup input

## Background

The previous inline draft removed the legacy modal from the DOM path, but still asked for session name and initial command before startup. That preserved the user's cognitive load: they still had to complete a creation form before reaching the input surface.

The expected flow is two lightweight states:

- **Session Launch Picker**: choose only immutable startup settings: project, AI engine, and Git worktree usage.
- **Startup Composer**: immediately show the input surface while the pending shell, worktree, and Claude/Codex runtime start in the background.

## Compatibility boundary

This Story describes the residual browser Session Launch Picker as a downstream compatibility consumer during migration. It is not the formal Project Provisioning or Project Catalog entry: project registration uses the Skill/CLI/API/MCP surfaces, and the server-side `session.create`/static endpoint is retired. Until retirement completes, the reachable Picker must consume the authenticated runtime Catalog, allow only exact project ID/explicit alias/GitHub repository grants, require explicit `local.path`, fail closed on auth/transport/Registry failures, and never re-add a requested project outside returned candidates. Workspace Setup and Connected-world Onboarding remain separate.

## Current PR Requirements

- Replace the inline creation draft with a Session Launch Picker that only contains project, engine, and Git worktree settings.
- After the picker is confirmed, create/select the pending shell immediately and start worktree/runtime startup in the background.
- Show Startup Composer as the primary surface for initial prompt entry while startup is pending.
- Show the confirmed project, engine, and workspace settings as locked metadata in Startup Composer.
- Do not ask for session name before startup; use automatic naming and leave rename to the existing session rename flow.
- Keep prompt queue/flush/retry/reload behavior owned by the existing shell-first startup machinery.

## Acceptance Criteria

- [ ] Desktop and mobile new-session entrypoints open Session Launch Picker, not the old create-session modal.
- [ ] Session Launch Picker contains only project, engine, and Git worktree controls.
- [ ] Confirming a worktree launch creates a pending shell, selects it, starts background startup, and shows Startup Composer without asking for a separate initial command.
- [ ] Startup Composer displays locked metadata for project, engine, and workspace setting.
- [ ] Typing in Startup Composer while startup is pending queues and persists the prompt; readiness flushes it once.
- [ ] Startup failure keeps the same composer visible with the user's prompt preserved and retry available.
- [ ] During migration, the remaining Session Launch Picker reads candidates only from the authenticated runtime Catalog; missing `local.path` is disabled and labeled Workspace Setup required.
- [ ] Non-empty project grants match only exact project ID, explicit alias, or GitHub repository name; prefix similarity never expands access.
- [ ] Auth, transport, Registry, or catalog-source failures leave only `general` and never reinsert a requested project outside returned candidates.
