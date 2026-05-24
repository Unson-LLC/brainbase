---
story_id: story-session-hibernation-mvp
title: Session Hibernation MVP: keep only visible Codex sessions hot
source_requirement:
  type: user_strategy
  description: Brainbase should stop keeping dozens of hidden Codex terminal runtimes hot; only visible or explicitly running sessions should consume runtime memory.
architecture_docs:
  - path: docs/architecture/session-hibernation-mvp-architecture.md
    status: created
    reason: Hibernation changes session runtime ownership, process lifecycle, and restore semantics.
  - path: docs/architecture/ADR-012-session-hibernation-runtime-lifecycle.md
    status: accepted
    reason: Phase 2 lifecycle mutation keeps the server runtime boundary as the state source of truth.
related_tasks:
  - task_source: VibePro
    task_ids: [story-session-hibernation-mvp]
status: draft
created_at: 2026-05-23
updated_at: 2026-05-23
---

# Session Hibernation MVP: keep only visible Codex sessions hot

## Background

Brainbase currently keeps many Codex-backed sessions alive as terminal runtimes. A hidden session can still hold a Codex process, Codex App Server process, PTY shim, tmux state, and multiple MCP child processes. Local process sampling on 2026-05-23 showed the shape of the problem:

```text
codex/app-server processes: 67 RSS_MB=848.9
pty shim processes: 28 RSS_MB=72.8
tmux processes: 4 RSS_MB=63.6
mcp-related processes: 303 RSS_MB=834.7
```

The main weakness is not just xterm rendering. It is that hidden sessions keep full runtime stacks hot even when the user is not looking at them.

This story introduces a phased hibernation model: keep state and restore information, but release process memory for sessions that are not visible and not actively running work.

## Product Bet

Brainbase should treat AI sessions as recoverable work objects, not as terminal processes that must stay alive forever. The UI should make the current memory posture visible and let the user safely keep only a small number of sessions hot.

## Status Model

- `hot`: visible or recently selected; runtime processes may be alive.
- `running`: background work is active; Brainbase must not hibernate automatically.
- `idle`: runtime is alive but there is no active turn, startup, or pending input.
- `hibernated`: session record and restore metadata remain, but runtime processes are stopped.
- `broken`: runtime restoration failed and requires explicit user recovery.
- `pinned`: user marked the session as never auto-hibernate.

## Phase Plan

### Phase 1: Runtime Inventory And Memory Visibility

Goal: make the problem observable before changing lifecycle behavior.

Scope:

- Add a server-side inventory that maps session ids to runtime-owned processes.
- Attribute process RSS by category: `codex`, `codex_app_server`, `pty_shim`, `tmux`, `ttyd`, `mcp`, `unknown_child`.
- Expose a read-only API for session runtime memory posture.
- Show memory posture in a small admin/developer surface or session diagnostics panel.
- Do not kill or pause any process in this phase.

Acceptance Criteria:

- [ ] A read-only endpoint returns per-session process categories and RSS totals.
- [ ] Unknown or unattributed processes are visible rather than silently ignored.
- [ ] Sessions with no known runtime processes are reported as cold/none.
- [ ] Runtime inventory does not mutate session state.
- [ ] Existing session creation and terminal input flows remain unchanged.

### Phase 1.5: Attribution Hardening And Eligibility Dry Run

Goal: close the safety gap between visibility and process stopping.

Scope:

- Attribute child processes through a uniquely matched session parent.
- Add a read-only `Hibernate eligibility` endpoint for a single session as an API/diagnostics dry run.
- Return explicit blocker reasons without stopping processes or mutating session state.
- Treat unknown, ambiguous, or shared process ownership as not eligible.
- Do not add a user-facing hibernate control yet; Phase 2 owns the visible action and remediation UX.

Acceptance Criteria:

- [ ] Child processes under one session-owned parent are counted in that session's runtime inventory.
- [ ] Unmatched `unknown_child` processes are visible in the unattributed list.
- [ ] `GET /api/sessions/:id/hibernate/eligibility` returns `eligible`, `reasons`, and `blockers`.
- [ ] Active turns, pending startup, pending input, active terminal owner, pinned sessions, missing restore metadata, and unknown process ownership block eligibility.
- [ ] No process is stopped and no session lifecycle state is mutated.
- [ ] Eligibility remains API/diagnostics-only until Phase 2 introduces manual hibernate and user remediation.

### Phase 2: Manual Hibernate And Resume

Goal: prove that one idle session can be safely put to sleep and restored.

Scope:

- Add explicit `Hibernate session` action for eligible sessions.
- Add explicit `Resume runtime` action for hibernated sessions.
- Persist hibernation metadata in session state.
- Capture a final terminal snapshot before hibernation when available.
- Stop only session-owned runtime processes.
- Resume through the existing Codex terminal resume path first.

Acceptance Criteria:

- [x] Idle Codex sessions can be manually hibernated.
- [x] Running sessions, pending startup sessions, and sessions with unsent input are rejected with a clear reason.
- [x] Hibernation records `hibernatedAt`, process inventory summary, restore command metadata, and `lastRuntimeSnapshot` when terminal snapshot capture is available.
- [x] Hibernated sessions stay visible in the session list with a clear status.
- [x] Opening a hibernated session can resume the runtime without creating a duplicate worktree.
- [x] If resume fails, the session becomes `broken` and preserves recovery metadata.

Phase 2 implementation slice:

- `POST /api/sessions/:id/hibernate` persists hibernation state and kills only inventory-attributed process ids.
- `POST /api/sessions/:id/resume-runtime` uses the existing terminal runtime start path and marks failed resumes as `broken`.
- Session list exposes `Hibernate session` and `Resume runtime` actions while preserving hibernated sessions in both timeline and grouped list modes.
- Shared HTTP client changes for lifecycle errors must preserve the existing auth-token injection path while carrying structured blocker and recovery metadata to the UI.

### Phase 3: Auto Hibernate And Hot Session Budget

Goal: reduce memory without requiring constant user cleanup.

Scope:

- Add eligibility-based auto hibernation.
- Add a configurable hot session budget.
- Keep visible, pinned, and running sessions hot.
- Prefer hibernating least-recently-visible idle sessions.
- Log every automatic decision with reason codes.

Acceptance Criteria:

- [ ] Auto hibernation only applies to idle eligible sessions.
- [ ] `running`, `pinned`, pending startup, and sessions with active terminal owners are not auto-hibernated.
- [ ] Hot session budget is configurable and defaults conservatively.
- [ ] The user can see why a session was hibernated.
- [ ] Auto hibernation can be disabled globally for rollback.

### Phase 4: App Server Loaded/NotLoaded Model

Goal: stop treating terminal text as the source of truth for Codex session state.

Scope:

- Use Codex App Server thread status to distinguish loaded and not-loaded Codex threads.
- Use `thread/read` for passive history display without resuming runtime.
- Use `thread/resume` for explicit runtime restoration when the user opens a hibernated session.
- Use `thread/unsubscribe` and `thread/loaded/list` to align Brainbase hot/cold state with Codex loaded/notLoaded state.
- Keep terminal transport as a compatibility path until App Server event rendering is stable.

Acceptance Criteria:

- [ ] Brainbase can show stored Codex thread metadata without loading the thread runtime.
- [ ] Hibernated App Server-backed sessions can display enough history for review without starting a turn.
- [ ] Opening a hibernated App Server-backed session resumes the thread intentionally.
- [ ] App Server loaded/notLoaded status is reflected in Brainbase session runtime status.
- [ ] Terminal snapshot is no longer required as the only way to know whether a Codex session exists.

## Out Of Scope

- Removing xterm/tmux terminal support.
- Killing running background work automatically.
- Full event-ledger implementation in Phase 1 or Phase 2.
- Sharing MCP processes across all sessions in the first implementation.
- Changing Graph SSOT or Philosophy Context storage.
- Replacing current session creation UX.

## Review Questions

- Is hibernation a session runtime state, a terminal transport state, or both?
- Which processes are definitely session-owned and safe to stop?
- What minimum metadata is required to resume without user confusion?
- What should count as active background work?
- Should a hibernated session still count as "open" in the UI?

## Verification Strategy

- Measure per-session RSS before and after hibernation.
- Verify that existing terminal transport tests still pass.
- Verify that a hibernated session can resume and accept input.
- Verify that auto hibernation never stops a running turn.
- Verify that 31013 canonical runtime remains clean after rollout.

## Success Metric

For a user with many old Codex sessions, Brainbase should reduce total Codex/MCP runtime RSS by hibernating idle hidden sessions while preserving the ability to reopen the work.

Initial target:

- Manual hibernation releases at least the session-owned Codex and MCP child processes for one idle session.
- Hot session budget keeps only visible or pinned sessions hot.
- User-perceived session reopen stays understandable even if resume takes time.
