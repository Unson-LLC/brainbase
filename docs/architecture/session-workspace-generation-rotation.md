---
title: Session Workspace Generation Rotation
status: draft
date: 2026-05-16
story_id: story-session-workspace-generation-rotation
---

# Session Workspace Generation Rotation

## Problem

`sessionId` is currently used as both the visible Brainbase session identity and
the physical workspace/bookmark identity. That makes merge cleanup fragile:
after `gh pr merge --delete-branch`, the visible session can remain attached to
a local workspace whose upstream was deleted.

## Design

Split visible session identity from workspace generation identity.

```js
{
  id: "session-1778113092477",
  activeWorkspaceId: "session-1778113092477-g3",
  worktree: {
    workspaceId: "session-1778113092477-g3",
    generation: 3,
    repo: "/Users/ksato/workspace/code/brainbase",
    path: "/Volumes/UNSON-DRIVE/brainbase-worktrees/session-1778113092477-g3-brainbase",
    branch: "session/session-1778113092477-g3",
    startCommit: "..."
  },
  workspaceHistory: [
    {
      workspaceId: "session-1778113092477-g2",
      branch: "session/session-1778113092477-g2",
      path: "/Volumes/UNSON-DRIVE/brainbase-worktrees/session-1778113092477-g2-brainbase",
      mergedPrUrl: "https://github.com/Unson-LLC/brainbase-unson/pull/751",
      mergedAt: "2026-05-16T06:32:37Z",
      mergeCommit: "...",
      retiredAt: "2026-05-16T06:32:40Z"
    }
  ]
}
```

## Lifecycle

1. The user merges a Brainbase session.
2. Brainbase pushes and merges the active workspace generation PR.
3. Brainbase verifies the merge commit is reachable from the merged base.
4. Brainbase stops input delivery to the old runtime.
5. Brainbase creates a new workspace generation from the latest merged base.
6. Brainbase starts the terminal/runtime in the new workspace path.
7. Brainbase updates `activeWorkspaceId`, `worktree`, and `workspaceHistory` in
   one persisted state transition.
8. Brainbase resumes input against the new runtime.

## Failure Mode

If merge succeeds but generation rotation fails, the visible session must enter
`rotation_blocked` or equivalent recoverable state. The old workspace generation
remains retired and must not receive input or commits.

## Boundaries

- `Session` is a logical product identity.
- `WorkspaceGeneration` is an implementation identity for jj/git workspace,
  bookmark, path, runtime cwd, and merge status.
- Runtime ownership, xterm transport, and terminal logs follow the visible
  session ID, but command execution uses the active workspace generation path.
