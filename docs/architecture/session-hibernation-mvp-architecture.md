---
adr_id: ADR-session-hibernation-mvp
title: Session hibernation runtime boundary
source_story:
  story_id: story-session-hibernation-mvp
  story_path: docs/stories/story-session-hibernation-mvp.md
status: proposed
created_at: 2026-05-23
updated_at: 2026-05-23
---

# ADR-session-hibernation-mvp: Session hibernation runtime boundary

## Status

Proposed

## Context

Brainbase currently gives users durable AI work sessions through terminal-backed runtimes. That durability has a cost: hidden sessions can continue holding Codex, PTY shim, tmux, App Server, and MCP processes. The memory cost scales with the number of historical sessions, not just the number of sessions the user is actively using.

The desired product behavior is not "kill old sessions." It is "preserve work while releasing runtime memory until the user needs the session again."

External reference points:

- VS Code separates terminal process reconnection/revive from restored scrollback. Brainbase should similarly separate session state from process liveness.
- xterm.js keeps scrollback in terminal buffers; hidden terminal surfaces should not be the only source of session history.
- Codex App Server exposes loaded/notLoaded thread concepts and read/resume APIs that can support passive history display without keeping every runtime hot.

## Decision

Introduce hibernation as a Brainbase session runtime state. Hibernation stops session-owned runtime processes while preserving enough metadata to display and resume the session.

The first implementation must be manual and observable before it becomes automatic.

## Boundary

### Session State Owns

- `runtimeStatus`: `hot`, `running`, `idle`, `hibernated`, `broken`.
- `runtimePinned`: user opt-out from auto hibernation.
- `hibernatedAt`.
- `lastRuntimeSnapshot`.
- `runtimeInventorySummary`.
- `restoreCommand` or App Server thread metadata.
- `hibernateReason`.
- `resumeFailureReason`.

### Runtime Inventory Owns

- Process discovery.
- Parent/child relationship inspection.
- RSS aggregation.
- Session id attribution.
- Process category classification.

### Runtime Lifecycle Owns

- Eligibility checks.
- Manual hibernate.
- Manual resume.
- Auto hibernate scheduling in later phases.
- Hot session budget enforcement in later phases.

### Terminal Transport Owns

- Active input/output for hot sessions.
- Final snapshot capture when available.
- Reconnection after resume.

Terminal transport must not be the canonical persistence layer for hibernated session history.

### Codex App Server Owns, In Later Phases

- Codex thread read/resume behavior.
- loaded/notLoaded status alignment.
- event subscriptions and unsubscriptions.

## Invariants

- Hibernation must never stop a running turn or startup flow.
- Hibernation must never destroy the worktree.
- Hibernation must preserve enough metadata to explain what happened.
- Resume must not create duplicate worktrees or duplicate session records.
- Auto hibernation must be reversible and globally disableable.
- Existing terminal sessions must continue to work while hibernation is off.
- App Server integration must not require replacing xterm/tmux in the same PR.

## Alternatives Considered

### Reduce xterm scrollback only

Rejected as the primary strategy. It can reduce browser memory, but local process sampling suggests backend Codex/MCP process stacks are the larger immediate cost.

### Kill old sessions permanently

Rejected. It destroys the core Brainbase promise that AI work remains recoverable.

### App Server migration first

Rejected for the first scope. App Server is strategically correct, but manual hibernation can reduce memory sooner using the existing resume path. App Server should become the Phase 4 foundation for better history/read/resume semantics.

### Global process pooling first

Deferred. MCP pooling or sharing may save substantial memory, but safe ownership boundaries are harder. First, Brainbase needs per-session inventory and hibernation semantics.

## Phasing

1. Inventory and visibility.
2. Manual hibernate/resume.
3. Auto hibernate and hot session budget.
4. App Server loaded/notLoaded model.

Each phase must be independently reviewable and measurable.

## Risks

- Process attribution may be incomplete if child processes detach or re-parent.
- Some MCP processes may be shared or ambiguous; ambiguous processes must not be killed.
- Codex resume metadata may be missing for older sessions.
- Users may expect hidden sessions to keep working. The UI must distinguish `running` from `hibernated`.
- Resume latency may be perceived as a regression unless the UI explains that the session is waking.

## Rollback

- Phase 1 is read-only.
- Phase 2 manual hibernation can be hidden behind a feature flag.
- Phase 3 auto hibernation must have a global disable switch.
- Phase 4 App Server-backed resume must keep terminal resume compatibility until proven.
