---
name: vibepro-story-refactor
description: Use when refactoring with VibePro so the agent follows Story -> Architecture -> Spec -> Task -> Code -> Gate -> PR instead of editing code first.
---

# VibePro Story Refactor

## Purpose

Use this Skill when VibePro is driving a refactor. The goal is to find and fix code defects, security risks, DRY gaps, and responsibility-boundary problems while preserving Story / Architecture / Spec consistency.

## Required Workflow

1. Start from a Story. If no Story exists, run `vibepro story derive` and inspect the Story map before implementing.
2. Check Architecture. If the boundary, dependency direction, or responsibility split is missing, restore or add Architecture docs before changing code.
3. Check Spec. If behavior, invariant, API, or data-flow expectations are missing, restore or add Spec docs before changing code.
4. Use VibePro task context:
   - `vibepro story plan <repo>`
   - `vibepro task create <repo> --from-plan --id <story-id>`
   - `vibepro task brief|plan|handoff <repo> --task <task-id> --id <story-id>`
5. Implement with focused tests. Prefer small changes tied to the task target files.
6. Run project verification and then `vibepro pr prepare`.
7. Use the review cockpit to decide whether to proceed, split, add evidence, waive with reason, or block.

## Refactor Target Criteria

Prioritize candidates that VibePro surfaces as:

- security boundary or authorization risk
- duplicated query, validation, or policy shape
- responsibility split failure
- Story / Architecture / Spec contradiction
- Graphify-related impact beyond changed files
- Gate evidence missing for changed behavior

## Guardrails

- Do not refactor only because code looks untidy. Tie the work to Story value and evidence.
- Do not widen scope after `task handoff` unless `pr prepare` confirms the scope remains reviewable.
- Do not mix repo-control changes, requirement SSOT recovery, runtime behavior, and E2E gate fixes unless the split-plan allows it.
- Do not merge or create a PR while required Gates are unresolved unless `waive_with_reason` is explicitly recorded.

## Completion Check

Before calling the work done:

- Story / Architecture / Spec relationship is clear.
- Tests or verification evidence exists for changed behavior.
- `review-cockpit.html` has a clear recommended decision.
- `human-review.json` can record the human decision.
- `vibepro pr create` is the PR creation path.
