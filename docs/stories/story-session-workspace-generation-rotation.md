---
story_id: story-session-workspace-generation-rotation
title: Session workspace generation rotation after merge
status: in_progress
created_at: 2026-05-16
updated_at: 2026-05-16
related_specs:
  - docs/specs/story-session-workspace-generation-rotation-spec.md
architecture_docs:
  - docs/architecture/session-workspace-generation-rotation.md
---

# Story: Session workspace generation rotation after merge

## Background

Brainbase sessions currently bind the visible session ID to the physical
workspace/bookmark identity. After a PR merge deletes the remote bookmark, the
same visible session can continue writing into a stale local workspace. Local
audit found many `upstream: gone` branches and local-only commits, including
cases where a merged PR branch later accumulated new unmerged commits.

The product behavior should stay simple: the user continues the same Brainbase
terminal session and conversation. The implementation must rotate only the
backing workspace/bookmark generation after merge.

## User Story

As a Brainbase user, after merging the current work I want to continue typing in
the same visible terminal/session, while Brainbase automatically moves the
runtime to a fresh workspace based on the latest merged base, so that follow-up
changes cannot be committed to a stale merged branch.

## Acceptance Criteria

- The visible Brainbase session ID, row, name, project, conversation log, and
  terminal history remain continuous across a successful merge.
- A successful merge retires the current workspace generation and creates a new
  workspace/bookmark generation from the latest merged base.
- After rotation, runtime `cwd`, worktree status, merge status, and future
  commits point at the new generation, not the merged/deleted bookmark.
- Input is not delivered to the old runtime while rotation is in progress.
- The session record keeps workspace history with PR URL, merge time, base
  commit, retired workspace ID, and active workspace ID.
- If rotation fails after merge, Brainbase blocks further editing and shows a
  recoverable state instead of allowing work on the stale workspace.
- VibePro PR evidence can trace implementation and tests to explicit spec
  clauses, without implicit fallback.

## Existing Client Session-Service Branches

This story changes only merge continuation behavior. Existing client-side
session list/cache/delete/filter/recovery branches stay unchanged:

- Cache restore and empty-cache handling, including `!cached?.sessions?.length`
  and `cached.currentSessionId`, continue to behave as before.
- Stopped-session and recovery checks, including
  `session.intendedState === 'stopped'` and
  `this.recoveryService.isStuck(sessionId)`, continue to behave as before.
- Generic update/delete/filter selection branches, including `previousSession`,
  `this._pendingDeletes.has(sessionId)`, `currentSessionId !== deletingSessionId`,
  `sessionFilter`, `!showArchivedSessions`, and `!currentSessionId`, continue to
  behave as before.
- Archive/delete flows may still use `wasCurrentSession` to switch away from a
  removed or archived session. `mergeSession` must not use that archive-style
  switch-away behavior; it keeps the same visible session selected.

## Non-goals

- Do not change the user-facing session identity model.
- Do not require the user to manually create a new session after merge.
- Do not reuse a merged/deleted workspace generation for follow-up edits.
