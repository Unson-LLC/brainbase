---
name: vibepro-human-review
description: Use when reviewing VibePro PR preparation artifacts, deciding whether to proceed, split, add evidence, waive with reason, or block.
---

# VibePro Human Review

## Purpose

Use this Skill when a human or AI reviewer needs to interpret VibePro PR artifacts. `pr-prepare.json` is the readiness source of truth; the review cockpit is the human control plane.

## Review Order

1. Read `.vibepro/pr/<story-id>/pr-prepare.json` `gate_status`.
2. Confirm `gate_status.overall_status`, `ready_for_pr_create`, unresolved Gates, and critical unresolved Gates.
3. Open `.vibepro/pr/<story-id>/review-cockpit.html`.
4. Read the recommended decision and reason.
5. Check split lanes and Graphify investigation scope.
6. For performance-sensitive PRs, read the `Performance Evidence` section in `pr-body.md` and the JSON runs under `.vibepro/pr/<story-id>/performance-runs/`.
7. Review next commands and confirm they use `vibepro pr create`.
8. Copy `human-review.json`, fill the review record, and keep it as the human decision artifact.

## Decision Rules

- `proceed`: Use only when `gate_status.ready_for_pr_create=true`, `gate_status.overall_status=ready_for_review`, and the split-plan does not require separation.
- `split_pr`: Use when scope is broad, repo-control files are mixed in, or split-plan recommends lanes.
- `add_evidence`: Use when required Gates need test, typecheck, integration, E2E, or requirement evidence.
- `waive_with_reason`: Use only with a specific reason for non-critical unresolved Gates. Critical unresolved Gates cannot be approved by reason alone.
- `block`: Use when Story, Architecture, Spec, security, or Gate evidence is contradictory or insufficient.

## Required Record

Fill these fields in `human-review.json`:

- `review_record.selected_decision`
- `review_record.reviewer`
- `review_record.reason`
- `review_record.reviewed_at`
- `review_record.comments` when needed

## Guardrails

- Do not treat `review-cockpit.html` as machine-readable truth; use the JSON sidecar.
- Do not treat `scope.status=reviewable` as completion approval. It is PR size/scope guidance only.
- Do not approve a PR only from the PR body. The cockpit and Gate DAG are the review control plane.
- Do not use raw `gh pr create`; it bypasses VibePro Gate enforcement and waiver recording.
- If a waiver is chosen, include the exact waiver reason in `vibepro pr create --allow-needs-verification --verification-waiver <reason>`.
- Do not approve a performance claim when the comparison says `改善率不明` / `not_comparable`.
- Do not accept server-side readiness as evidence for user-perceived readiness. User-perceived metrics need `browser_e2e`, `client_marker`, or `manual_observation`.
- Check that snapshot visible, DOM visible, API completed, server ready, and interactive ready are not mixed into one completion condition.

## Performance Evidence Review

For a PR that claims speed improvement, require:

- Metric definition exists in the Story `performanceMetrics[]`.
- Runs exist under `.vibepro/pr/<story-id>/performance-runs/*.json`.
- before and after use the same `metricId` and `completionCondition`.
- p50, p90, max, sample count, and incomplete rate are visible.
- `blocked`, `needs_review`, `timeout`, `auth_required`, `resource_unavailable`, or `unknown` runs are retained instead of silently dropped.
- DB/server metrics and user-perceived metrics are separate when both matter.
