---
story_id: str.brainbase.sns-ledger-manual-refresh
title: SNS cockpit manual ledger refresh spec
status: active
---

# SPEC: SNS cockpit manual ledger refresh

## Story

`str.brainbase.sns-ledger-manual-refresh`

## Invariants

- INV-1: Manual refresh must recompute the active week from the current Asia/Tokyo date before calling `listPosts`.
- INV-2: Manual refresh must call the existing `apiClient.listPosts({ startDate, endDate })` path and must not mutate posts.
- INV-3: The user must be able to trigger refresh from the normal calendar toolbar, not only from an error state.

## Scenarios

- S-1: A view constructed for the previous week is still open on Monday; clicking update fetches Monday-Sunday for the new current week.
- S-2: A new ohayo review pack is inserted while the SNS page is open; clicking update displays it without browser hard refresh.
- S-3: If the Ledger API fails, the existing visible error and retry path remains available.

## Verification

- `tests/ui/views/sns-growth-cockpit-view.test.js`
- `tests/e2e/sns-growth-cockpit.spec.js`

