---
name: vibepro-workflow
description: Use when working with VibePro CLI, Graphify, Story diagnosis, task planning, PR preparation, Gate evidence, or VibePro review artifacts.
---

# VibePro Workflow

## Purpose

Use VibePro as a Story / Architecture / Spec / Graphify / Gate control plane. The CLI creates evidence; this Skill tells the agent how to use that evidence without skipping the intended order.

## Operating Order

1. Confirm the target repository and current branch.
2. Initialize only when needed: `vibepro init <repo> --language ja`.
3. Select or create the Story before diagnosing or changing code.
4. Import Graphify context before impact-sensitive work: `vibepro graph <repo> --run-graphify`.
5. Diagnose and derive the repo context:
   - `vibepro story diagnose <repo> --id <story-id> --run-graphify`
   - `vibepro story derive <repo> --run-graphify`
   - `vibepro story map <repo>`
6. Plan work from VibePro evidence: `vibepro story plan <repo>`.
7. Create task context before implementation: `vibepro task create <repo> --from-plan --id <story-id>`.
8. After code changes, run `vibepro pr prepare <repo> --story-id <story-id>`.
9. Open `review-cockpit.html` first, then deep-dive into `gate-dag.html`, `split-plan.html`, and `pr-body.md`.
10. Use `vibepro pr create`; do not bypass VibePro with raw `gh pr create`.

## Guardrails

- Do not treat VibePro diagnosis as truth by itself. Verify with code, tests, runtime logs, or product behavior.
- Do not patch graph-sensitive runtime, auth, data, or UI state-machine code before checking Graphify impact.
- Do not skip Story -> Architecture -> Spec ordering when the task is a refactor.
- Do not ignore unresolved Gates. Add evidence, split the PR, block, or record a waiver reason.
- Keep JSON artifacts as the machine-readable source of truth. HTML is the human control plane.

## Key Artifacts

- `.vibepro/stories/story-map.md`: repo Story map for human review.
- `.vibepro/stories/story-plan.md`: candidate work items.
- `.vibepro/pr/<story-id>/review-cockpit.html`: first screen for human decision.
- `.vibepro/pr/<story-id>/human-review.json`: machine-readable human decision template.
- `.vibepro/pr/<story-id>/gate-dag.html`: Gate dependency view.
- `.vibepro/pr/<story-id>/split-plan.html`: split lanes and Graphify investigation scope.
