---
spec_id: SPEC-story-session-workspace-generation-rotation
title: Session Workspace Generation Rotation Specification
status: draft
date: 2026-05-16
story_id: story-session-workspace-generation-rotation
related_architecture:
  - docs/architecture/session-workspace-generation-rotation.md
implementation_files:
  - server/services/worktree-service.js
  - server/controllers/session/worktree-handlers.js
  - server/controllers/session/runtime-handlers.js
  - server/controllers/state-controller.js
  - public/modules/domain/session/session-service.js
  - public/modules/app/session-management-mixin.js
  - public/modules/core/terminal-transport-client.js
test_files:
  - tests/server/services/worktree-service-workspace-generation.test.js
  - tests/server/controllers/session-workspace-rotation.test.js
  - tests/ui/session-workspace-generation-rotation.test.js
---

# SPEC: Session Workspace Generation Rotation

## Invariants

- **INV-1**: The visible Brainbase `session.id` remains stable across merge and
  workspace rotation.
- **INV-2**: Every post-merge edit, commit, status check, and runtime start uses
  the active workspace generation path, not a retired workspace path.
- **INV-3**: A retired workspace generation cannot receive terminal input,
  runtime restarts, commit operations, or merge operations.
- **INV-4**: The active workspace generation is based on the verified latest
  merged base after the PR merge.
- **INV-5**: Session state records enough history to audit each retired
  generation, including workspace ID, branch/bookmark, path, PR URL, merge time,
  and merge commit when available.

## Contracts

- **C-1**: `WorktreeService.create` accepts an explicit workspace generation
  identity and must not derive the physical workspace/bookmark solely from the
  visible `sessionId`.
- **C-2**: `WorktreeService.merge` returns merge metadata plus a rotation plan or
  result that identifies the retired and next workspace generations.
- **C-3**: `POST /api/sessions/:id/merge` persists `workspaceHistory`,
  `activeWorkspaceId`, and the new `worktree` atomically after successful
  rotation.
- **C-4**: Runtime lifecycle APIs resolve `cwd` from the active workspace
  generation and reject retired generation paths.
- **C-5**: The client keeps the same selected session and terminal surface while
  merge rotation is in progress.

## Scenarios

- **S-1**: A user merges a clean worktree session. The PR is merged, generation
  `g1` is retired, generation `g2` is created from the latest merged base, and
  the visible session remains selected.
- **S-2**: A user types during rotation. Input is held or rejected with a
  transient rotation state and is not sent to `g1`.
- **S-3**: Rotation fails after the PR merge succeeds. The visible session enters
  a recoverable blocked state and cannot write to `g1`.
- **S-4**: A later merge uses `g2` and appends a second history entry instead of
  mutating the previous history record.
- **S-5**: Worktree status on a rotated session reports the active generation
  status and exposes retired generation metadata only as history.

## Anti-patterns

- **AP-1**: Reusing `session/${sessionId}` as the bookmark after it has been
  merged and deleted remotely.
- **AP-2**: Switching the canonical repo to `develop` as the only post-merge
  recovery mechanism.
- **AP-3**: Marking a session as merged while allowing terminal input to keep
  targeting the old runtime.
- **AP-4**: Creating a new visible Brainbase session row when the user's intent
  is to continue the same session.

## Verification

| Clause | Test |
|---|---|
| INV-1, C-5, AP-4 | `tests/ui/session-workspace-generation-rotation.test.js` |
| INV-2, INV-3, C-4, S-2, AP-3 | `tests/server/controllers/session-workspace-rotation.test.js` |
| INV-4, C-1, C-2, S-1, AP-1, AP-2 | `tests/server/services/worktree-service-workspace-generation.test.js` |
| INV-5, C-3, S-3, S-4, S-5 | `tests/server/controllers/session-workspace-rotation.test.js` |
