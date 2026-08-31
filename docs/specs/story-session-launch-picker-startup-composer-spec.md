---
spec_id: story-session-launch-picker-startup-composer-spec
title: Session Launch Picker and Startup Composer specification
source_story: docs/user_stories/retired/story-session-launch-picker-startup-composer.md
status: retired
created_at: 2026-05-26
updated_at: 2026-09-01
---

# Retired spec: Session Launch Picker and Startup Composer

## Scope

- `public/index.html`
- `public/style.css`
- `public/modules/app/event-listeners-mixin.js`
- `public/modules/app/session-creation-mixin.js`
- `tests/ui/session-creation-mixin.test.js`
- `tests/e2e/story-session-shell-first-startup-ux.spec.js`
- `tests/e2e/story-inline-session-creation-ux.spec.ts`
- `docs/brainbase-capabilities/capabilities/session.create.yml`
- `docs/brainbase-capabilities/capabilities/project.selector.yml`

## Compatibility boundary

This spec is retained as historical evidence only. Codex app/CLI owns task and
worktree creation. The Brainbase browser picker and `/api/sessions` creation
paths are retired and must not be reachable from product entrypoints.

## Current retirement invariants

- INV-1: `EVENTS.CREATE_SESSION` must not activate `#create-session-modal` or `#session-launch-picker`.
- INV-2: The create-session event must show the Codex migration notice.
- INV-3: No reachable Brainbase browser entrypoint may call a retired session creation API.
- INV-4: Historical picker and composer implementation is frozen compatibility code, not an active capability.
- INV-9: Workspace Setup project candidates come only from the authenticated runtime Catalog; `/api/config` legacy topology never substitutes for it.
- INV-5: A non-empty Workspace Setup grant matches only exact project ID, explicit alias, or GitHub repository name; prefix/parent/hyphenless inference is forbidden.
- INV-6: A selectable Workspace Setup project has explicit `local.path`; missing path is disabled and never guessed.
- INV-7: Catalog auth, transport, Registry, or source.status unavailable/error resets Workspace Setup to `general`/fail-closed.

## Contracts

- CON-1: `EVENTS.CREATE_SESSION` shows the Codex migration notice and never calls `openSessionLaunchPicker()`.
- CON-2: Legacy picker methods remain frozen historical implementation and are not product entrypoints.
- CON-3: `#session-launch-picker` belongs to the retired `session.create` capability.
- CON-4: Workspace Setup options are sourced from the authenticated runtime Catalog and use exact project ID, explicit alias, or GitHub repository grants only.
- CON-5: Workspace Setup options without explicit `local.path` are disabled and labeled as requiring Workspace Setup; no path is guessed.
- CON-6: Auth, transport, Registry, or catalog-source failures expose unavailable/error state and retain only `general`.
