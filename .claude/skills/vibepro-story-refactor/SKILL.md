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
5. Use a diagnosis package when the refactor has a clear purpose:
   - UI behavior: `vibepro check ui <repo> --story-id <story-id>`
   - Security boundary: `vibepro check security <repo> --story-id <story-id>`
   - Performance readiness: `vibepro check performance <repo> --story-id <story-id>`
   - Architecture boundary: `vibepro check architecture <repo> --story-id <story-id>`
   - Launch readiness: `vibepro check launch-readiness <repo> --story-id <story-id>`
6. For performance refactors, define Story-level metrics before claiming improvement. Separate DB/server readiness from user-perceived readiness.
7. Implement with focused tests. Prefer small changes tied to the task target files.
8. Run project verification and then `vibepro pr prepare`.
9. Read `pr-prepare.json` `gate_status` before treating the work as PR-ready.
10. If Agent Review Gate is unresolved, run the VibePro parallel subagent review workflow before finalizing:
   - `vibepro review prepare <repo> --id <story-id> --stage <stage>`
   - dispatch each role in `parallel-dispatch.md` as a separate parallel subagent review,
   - `vibepro review record` each result,
   - rerun `vibepro pr prepare`.
11. Use the review cockpit to decide whether to proceed, split, add evidence, waive with reason, or block.

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
- Do not treat `scope.status=reviewable` as completion approval. It is PR size/scope guidance only.
- Do not merge or create a PR unless `gate_status.ready_for_pr_create=true` and `gate_status.overall_status=ready_for_review`.
- Do not waive critical unresolved Gates with a reason alone. Critical Gates require evidence closure or a split/block decision.
- Do not call a VibePro refactor complete while `gate:agent_review` is `needs_review`, `missing`, `stale`, `block`, or `failed`; complete the parallel subagent reviews first.

## Completion Check

Before calling the work done:

- Story / Architecture / Spec relationship is clear.
- Tests or verification evidence exists for changed behavior.
- Purpose-level diagnosis package evidence exists when UI, security, performance, architecture, or launch readiness was the stated goal.
- Performance improvements have comparable before/after evidence, or the PR explicitly says improvement rate is unknown and why.
- `pr-prepare.json` `gate_status.ready_for_pr_create` is true.
- `gate:agent_review` has passed when VibePro required parallel subagent review.
- `review-cockpit.html` has a clear recommended decision.
- `human-review.json` can record the human decision.
- `vibepro pr create` is the PR creation path.
