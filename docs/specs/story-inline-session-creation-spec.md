---
spec_id: story-inline-session-creation-spec
title: Retired Brainbase inline session creation specification
source_story: docs/user_stories/retired/story-inline-session-creation.md
status: retired
created_at: 2026-05-22
updated_at: 2026-09-01
---

# Retired spec: Brainbase inline session creation

## Current invariants

- `EVENTS.CREATE_SESSION` shows a migration notice directing the user to Codex.
- The event handler does not call `openInlineSessionDraft()`,
  `openSessionLaunchPicker()`, or a session creation API.
- Brainbase `/api/sessions` creation paths remain `410 Gone`.
- Historical inline draft and picker methods are frozen compatibility code, not
  product entrypoints.
- `session.create` owns every retired creation surface.
- `project.selector` owns only the Workspace Setup Project Catalog consumer.

## Verification

- `tests/e2e/story-inline-session-creation-pr-gate.spec.ts` verifies the
  fail-closed event and capability ownership boundary.
- Project Provisioning browser E2E verifies Workspace Setup independently of
  the retired session picker.
