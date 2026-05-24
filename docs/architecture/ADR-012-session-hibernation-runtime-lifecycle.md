# ADR-012: Session Hibernation Runtime Lifecycle

Status: Accepted
Date: 2026-05-23

## Context

Brainbase Phase 2 hibernation changes runtime ownership and process lifecycle. The risky boundary is that a UI action can stop local Codex, ttyd, tmux, and child processes while preserving the Brainbase session as a recoverable work object.

## Decision

- Manual hibernation is Codex-only until non-Codex restore semantics are specified.
- The session runtime controller is the source of truth for lifecycle state persistence.
- Clients may update local display state from lifecycle API responses, but must not persist a second generic state patch after hibernate or resume succeeds.
- Hibernation stops only PIDs that runtime inventory attributes to the target session.
- Any non-ESRCH failure while stopping an attributed process fails hibernation instead of reporting the session as hibernated.
- Resume uses the persisted session engine and Codex restore id; request body engine cannot override the stored session engine.
- Failed resume writes `intendedState = broken` and `runtimeState = broken` with `resumeFailureReason`.

## Consequences

This keeps Phase 2 conservative: one idle Codex session can be manually put to sleep and resumed without introducing automatic budget enforcement. Phase 3 can add auto-hibernation only after the manual lifecycle proves safe.
