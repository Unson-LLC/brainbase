---
story_id: str.brainbase.sns-posted-content-dedupe
title: SNS posted content dedupe spec
status: active
---

# SPEC: SNS posted content dedupe

## Invariants

- INV-1: `upsertReviewPack` must detect duplicate normalized body text for the same account before creating or updating a reviewable post.
- INV-2: Duplicate body text is reserved by statuses `review_needed`, `approved`, `scheduled`, `publishing`, `posted`, and `learning_ready`.
- INV-3: Duplicate body text is not reserved by statuses `skipped`, `deleted`, or `publish_failed`.
- INV-4: Rows in terminal public states `posted`, `learning_ready`, and `deleted` are immutable to review-pack import.
- INV-5: E2E test server runs default `BRAINBASE_VAR_DIR` to `var/e2e-runtime` unless the caller explicitly sets another value.

## Scenarios

- S-1: A stale old row has the exact body of a public post and status `review_needed`; importing the same body for today returns it in `skipped` and does not create a new calendar post.
- S-2: A posted row exists for a slot; importing a new review pack for the same slot leaves the posted body and posted URL unchanged.
- S-3: Running SNS Growth Cockpit E2E writes test records under the E2E runtime var directory rather than the operator ledger path.

