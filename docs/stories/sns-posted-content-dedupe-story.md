---
story_id: str.brainbase.sns-posted-content-dedupe
title: SNS posted content dedupe and test ledger isolation
status: active
horizon: M5
view: ops
period: 2026-05
spec_docs:
  - docs/specs/sns-posted-content-dedupe-spec.md
architecture_docs:
  - docs/architecture/sns-posted-content-dedupe-architecture.md
---

# SNS posted content dedupe and test ledger isolation

As the SNS operator, I want the posting ledger to treat already-posted or already-managed copy as unavailable for new review slots, so the cockpit does not show content that has already gone public as a new post.

## Background

The public X post `2055199687339303164` was already posted, but the matching ledger row remained `review_needed` without `posted_url`. In addition, Playwright E2E imports were written to the runtime ledger, polluting the actual calendar with `*_e2e_*` records.

## Acceptance Criteria

- AC-1: Importing a review pack with body text that already exists in a live ledger row does not create another reviewable/scheduled post.
- AC-2: Posted, learning-ready, publishing, scheduled, approved, and review-needed rows all reserve their normalized body text unless they are deleted, skipped, or publish-failed.
- AC-3: Re-importing the same account/date/slot does not overwrite a posted, learning-ready, or deleted ledger row.
- AC-4: Duplicate import results are explicit in the API response as `skipped`.
- AC-5: Playwright E2E test server runs use an isolated test var directory by default and do not write to the operator runtime ledger.

