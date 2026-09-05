---
name: vibepro-story-refactor
description: Use when a refactor benefits from a VibePro-assisted focused Story and testable Spec. Architecture, Graphify, Task artifacts, Gates, and special PR creation are conditional rather than mandatory ceremonies.
---

# VibePro Story Refactor

## Standard Loop

> Story → Spec → implement → affected tests → one review wave → GitHub PR → CI → merge

1. Resolve the governing Brainbase judgment, conventions, and project knowledge by reference.
2. Define one focused Story with a user-visible or operator-visible outcome and explicit acceptance criteria.
3. Add Architecture/ADR only when the refactor changes a boundary, ownership, data contract, security boundary, deployment model, or rollback strategy.
4. Use Graphify only when dependency or graph evidence can change the refactor or its tests.
5. Write the smallest Spec that protects behavior and invariants.
6. Refactor the smallest coherent surface and run affected tests.
7. Run one bounded review wave. Fix evidence-backed blockers; move all non-blocking improvements to follow-up work.
8. Open the PR through the repository's normal GitHub flow and let CI run the full suite.

## Refactor Selection

Prefer refactors tied to demonstrated value or risk: repeated defects, security or tenant-boundary exposure, data integrity risk, ownership confusion, expensive repeated work, or an acceptance criterion that cannot be tested under the current structure. Do not refactor merely because code looks untidy.

## Completion

The Story outcome and Spec invariants are satisfied, affected tests pass, material boundary or rollback changes are documented, blocking findings are closed on the affected delta, and the PR follows normal repository permissions. VibePro summaries may support the handoff but do not authorize merge or deployment.
