---
story_id: str.brainbase.sns-ledger-manual-refresh
title: SNS cockpit manual ledger refresh architecture
status: active
---

# Architecture: SNS cockpit manual ledger refresh

## Story

`str.brainbase.sns-ledger-manual-refresh`

## Decision

Keep SNS Growth Cockpit as the owner of the visible calendar range. Add a manual refresh action that resets the view to the current JST week and then reloads posts through the existing SNS Posting Ledger API client.

## Rationale

The server default range is correct when the page is freshly loaded, but the open browser view owns `today`, `startDate`, and `endDate` after construction. Auto refresh intentionally avoids changing the user's active range, so an explicit operator action is the right place to say "show me the current week now."

## Boundaries

- UI state and action handling: `public/modules/ui/views/sns-growth-cockpit-view.js`
- Unit behavior: `tests/ui/views/sns-growth-cockpit-view.test.js`
- Real API path E2E: `tests/e2e/sns-growth-cockpit.spec.js`

## Non-Goals

- Do not add background date-boundary timers in this slice.
- Do not change posting, approval, delete, or publishing behavior.

