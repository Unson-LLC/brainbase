---
name: vibepro-human-review
description: Use when reviewing VibePro PR preparation artifacts, deciding whether to proceed, split, add evidence, waive with reason, or block.
---

# VibePro Human Review

## Purpose

Use this Skill when a human or AI reviewer needs to interpret VibePro PR artifacts. The review cockpit is the first screen; JSON remains the source of truth.

## Review Order

1. Open `.vibepro/pr/<story-id>/review-cockpit.html`.
2. Read the recommended decision and reason.
3. Check unresolved Gates and required evidence.
4. Check split lanes and Graphify investigation scope.
5. Review next commands and confirm they use `vibepro pr create`.
6. Copy `human-review.json`, fill the review record, and keep it as the human decision artifact.

## Decision Rules

- `proceed`: Use only when required Gates are complete and the split-plan does not require separation.
- `split_pr`: Use when scope is broad, repo-control files are mixed in, or split-plan recommends lanes.
- `add_evidence`: Use when required Gates need test, typecheck, integration, E2E, or requirement evidence.
- `waive_with_reason`: Use only with a specific reason. The reason must explain why unresolved Gates are acceptable.
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
- Do not approve a PR only from the PR body. The cockpit and Gate DAG are the review control plane.
- Do not use raw `gh pr create`; it bypasses VibePro Gate enforcement and waiver recording.
- If a waiver is chosen, include the exact waiver reason in `vibepro pr create --allow-needs-verification --verification-waiver <reason>`.
