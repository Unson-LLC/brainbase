---
name: vibepro-workflow
description: Use when executing or interpreting VibePro CLI for one focused repository-local change. Do not use it as the authority for organization strategy, Brainbase judgment, knowledge ownership, merge approval, deployment, or secret access.
---

# VibePro Workflow

## Purpose

VibePro keeps one accepted change connected from Story to Spec, implementation, affected tests, one review wave, and PR handoff. Brainbase remains the authority for organization judgment, project knowledge, development conventions, infrastructure and secret locations, and reusable team learning.

The standard loop is:

> Story → Spec → implement → affected tests → one review wave → GitHub PR → CI → merge

## Operating Contract

1. Use the current Brainbase Judgment receipt and only the smallest relevant Knowledge/Graph context. Link canonical IDs or paths instead of copying organization policy into the Story.
2. Keep one focused Story with one user-visible outcome and explicit acceptance criteria.
3. Add or update Architecture/ADR only when the change materially alters a system boundary, ownership, data contract, security boundary, deployment model, or rollback strategy.
4. Run Graphify or `vibepro story diagnose ... --run-graphify` only when graph evidence can change the implementation or test decision.
5. Write the smallest Spec that makes accepted behavior and invariants testable.
6. Implement the change and run only affected tests locally. Let CI run the full suite.
7. After implementation stabilizes, run at most one review wave with no more than three independent roles in parallel and five total dispatches.
8. Fix only findings that prove an unmet acceptance criterion, security or tenant-boundary violation, data corruption/loss risk, unsafe changed release/rollback path, or inability of CI to validate the change. Move useful non-blocking findings to follow-up work.
9. Use `vibepro pr prepare <repo> --story-id <story-id>` only when its concise handoff is useful. Legacy Gate, readiness, lifecycle, and stale-review projections are informational and cannot block the PR.
10. Open or refresh the PR through the repository's normal GitHub flow. `gh pr create` is valid where it is the repository convention; `vibepro pr create` is optional convenience.
11. Merge, deploy, production writes, external actions, and secret access remain governed by the repository and organization permission boundary, never by VibePro.

## Brainbase Handoff

- Before implementation, consume Brainbase decisions and knowledge by reference; do not fork their content into VibePro artifacts.
- After verification, retain only reusable and verified development learning as the appropriate Brainbase Knowledge Event or candidate. Do not promote raw logs, transient failures, or unverified reviewer prose.
- A missing Brainbase fact should trigger targeted retrieval or an explicit unknown, not a new VibePro ceremony.

## Retired Contracts

Do not require `vibepro execute start`, managed-worktree execution, a general Gate DAG, review authorize/start/close/repair, mandatory Agent Review Gate dispatch, lifecycle accounting, automatic audit bundles, or a raw `gh pr create` prohibition.

## Evidence Boundary

VibePro output is advisory evidence, not truth by itself. Verify claims with changed code, tests, runtime behavior, CI, and the canonical Brainbase context that actually governs the decision.
