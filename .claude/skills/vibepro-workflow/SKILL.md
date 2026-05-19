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
6. When the user asks for a purpose-level check, use diagnosis packages instead of guessing the scanner set:
   - `vibepro check list`
   - `vibepro check ui <repo>`
   - `vibepro check security <repo>`
   - `vibepro check performance <repo>`
   - `vibepro check architecture <repo>`
   - `vibepro check pr-readiness <repo> --base <ref> --head <ref>`
   - `vibepro check launch-readiness <repo>`
7. For performance improvement stories, define and record Story-level performance evidence before claiming speedups:
   - `vibepro performance define <repo> --id <story-id> --metric-id <id> --user-story <text> --start-condition <text> --completion-condition <text> --evidence-source <type>`
   - `vibepro performance record <repo> --id <story-id> --metric-id <id> --label before|after --status completed --duration-ms <ms> --evidence-source <type:ref:summary>`
   - `vibepro performance compare <repo> --id <story-id>`
8. Plan work from VibePro evidence: `vibepro story plan <repo>`.
9. Create task context before implementation: `vibepro task create <repo> --from-plan --id <story-id>`.
10. After code changes, run `vibepro pr prepare <repo> --story-id <story-id>`.
11. Read `.vibepro/pr/<story-id>/pr-prepare.json` `gate_status` before treating work as PR-ready.
12. If `gate_status.agent_review_instruction` is present, treat it as an explicit instruction to run parallel subagent review:
   - Run each listed `vibepro review prepare <repo> --id <story-id> --stage <stage>`.
   - Open the generated `.vibepro/reviews/<story-id>/<stage>/parallel-dispatch.md`.
   - Start the listed Codex/Claude Code subagents in parallel, one role per subagent.
   - Record every result with `vibepro review record`.
   - Rerun `vibepro pr prepare` and continue only after `gate:agent_review` passes.
13. Open `review-cockpit.html` first, then deep-dive into `gate-dag.html`, `split-plan.html`, and `pr-body.md`.
14. Use `vibepro pr create`; do not bypass VibePro with raw `gh pr create`.

## Guardrails

- Do not treat VibePro diagnosis as truth by itself. Verify with code, tests, runtime logs, or product behavior.
- Do not patch graph-sensitive runtime, auth, data, or UI state-machine code before checking Graphify impact.
- Do not skip Story -> Architecture -> Spec ordering when the task is a refactor.
- Do not treat `scope.status=reviewable` as completion approval. It is PR size/scope guidance only.
- Do not ignore unresolved Gates. Add evidence, split the PR, block, or record a waiver reason.
- Do not waive critical unresolved Gates with a reason alone. Critical Gates require evidence closure or a split/block decision.
- Do not treat Agent Review Gate as optional. When it is unresolved, the coordinator must prepare, dispatch, record, and rerun the VibePro review flow before calling the work complete.
- Keep JSON artifacts as the machine-readable source of truth. HTML is the human control plane.
- Do not claim user-perceived performance improvement from server logs alone. Use a separate `user_perceived` metric backed by `browser_e2e`, `client_marker`, or `manual_observation`.
- Do not mix server readiness, API completion, DOM visibility, snapshot visibility, and interactive readiness as the same completion condition. Define them as separate metrics.
- Do not treat type-check or a superficially rendered UI as enough when UI code introduces `/api/...` calls. Network Contract Gate requires matching Next.js routes and network-aware flow evidence for API 4xx/5xx.
- Do not treat Story-level E2E existence as enough for UI-heavy changes. Clickable-looking controls on the changed screen need an interaction contract: save/mutate, visible state change, navigation, scroll/focus, disabled, or explicit unfinished state.

## Git / Worktree Dirty Guardrails

- Do not use `git stash`, `git restore`, `git reset`, or checkout changes as the first response to a dirty repository worktree. First classify the dirty state.
- Before cleaning dirty state, record:
  - `git status --short --branch`
  - `git diff --name-status`
  - `git diff --cached --name-status`
  - `git diff --stat`
  - `git diff --cached --stat`
  - `git reflog --date=iso -8 HEAD`
  - `git reflog --date=iso -8 <current-branch>`
- If a checked-out branch moved via an external sync, merge, rebase, or another worktree, verify whether the dirty diff is a stale reverse diff before treating it as user work.
- A stale reverse diff is likely when the branch reflog advanced from an old commit to `HEAD`, while `git diff --cached` or `git diff` is exactly the inverse of the commits between that old commit and `HEAD`.
- Prove this before cleanup by comparing the dirty diff with the commit range, for example:
  - `git diff --stat <old-commit> HEAD`
  - `git diff --stat HEAD <old-commit>`
  - `git diff --name-status <old-commit> HEAD`
  - `git diff --name-status HEAD <old-commit>`
- If the dirty state is a proven stale reverse diff, say so explicitly and then synchronize the worktree/index to `HEAD` with the least destructive command that resolves the observed state. Do not preserve it as a stash unless the user asks for archival.
- If the dirty state contains files or hunks that do not match the stale reverse diff, treat them as possible user work and do not clean them without reporting the exact files and asking for direction when needed.

## Key Artifacts

- `.vibepro/stories/story-map.md`: repo Story map for human review.
- `.vibepro/stories/story-plan.md`: candidate work items.
- `.vibepro/pr/<story-id>/pr-prepare.json`: PR readiness source of truth; check `gate_status`.
- `.vibepro/pr/<story-id>/review-cockpit.html`: first screen for human decision.
- `.vibepro/pr/<story-id>/human-review.json`: machine-readable human decision template.
- `.vibepro/pr/<story-id>/gate-dag.html`: Gate dependency view.
- `.vibepro/pr/<story-id>/split-plan.html`: split lanes and Graphify investigation scope.
- `.vibepro/reviews/<story-id>/<stage>/parallel-dispatch.md`: required parallel subagent dispatch instructions when Agent Review Gate is unresolved.
- `.vibepro/checks/<pack>/<run-id>/check.json`: purpose-level diagnosis package evidence.
- `.vibepro/checks/<pack>/<run-id>/check.md`: human-readable diagnosis package report.
- `.vibepro/checks/ui/<run-id>/check.json`: UI check evidence, including `flow_design.interactive_contract_hits`.
- `.vibepro/pr/<story-id>/performance-runs/*.json`: Story-level performance evidence runs.
