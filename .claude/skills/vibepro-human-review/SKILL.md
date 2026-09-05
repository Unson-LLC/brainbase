---
name: vibepro-human-review
description: Use for one bounded review wave on a VibePro-assisted change. Review the accepted Story, Spec, changed surface, and verification evidence; do not treat legacy Gate or cockpit artifacts as approval authority.
---

# VibePro Human Review

## Review Inputs

Review the focused Story and acceptance criteria, the smallest governing Spec, changed files, affected-test evidence, and any material Architecture/ADR or rollback change. A `vibepro pr prepare` summary may help navigation, but it is not the source of merge authority.

## One-Wave Review

- Run at most one review wave after implementation is stable.
- Use no more than three independent roles in parallel and no more than five total dispatches.
- Treat timeout, empty output, wrong request, or agent failure as a review-system failure rather than a product defect.
- When a blocking finding is fixed, reverify only the affected delta within the same wave.
- Move useful non-blocking findings to a follow-up Story or Issue instead of expanding the current change.

## Blocking Standard

A finding blocks only when evidence shows one of the following:

- an acceptance criterion is unmet;
- a security or tenant boundary is violated;
- data may be corrupted or lost;
- the changed release or rollback path is unsafe;
- CI cannot validate the changed behavior.

Everything else is advice or follow-up work. Legacy `gate_status`, readiness, lifecycle, stale-review, `review-cockpit.html`, or `human-review.json` projections do not create approval requirements.

## Decision Boundary

The reviewer may recommend proceed, fix, split, or follow-up. Actual PR approval, merge, deploy, production writes, external actions, and secret access remain governed by the repository and organization permission boundary. VibePro does not replace human or policy authority.
