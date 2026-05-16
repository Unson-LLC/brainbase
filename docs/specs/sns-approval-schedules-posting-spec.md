# SPEC: SNS approval schedules posting

## Story

`str.brainbase.sns-approval-schedules-posting`

## Scope

This spec covers the operational status transition used by SNS Growth Cockpit and `/api/sns-growth/posts/:id`.

## Invariants

- INV-1: `scheduled` is the only ledger status that the scheduled publisher scans for automatic posting.
- INV-2: A post with `scheduled_at`, or with both `date` and `time`, already has a planned publishing slot.
- INV-3: Approving a post with a planned publishing slot must result in `scheduled`, not a dormant `approved` state.
- INV-4: `approved` remains a valid ledger status for posts that are approved but do not yet have a publishing slot.
- INV-5: The approve action must not call the publish bridge directly.

## API Contract

### PATCH `/api/sns-growth/posts/:id`

If the existing post has a planned publishing slot and the request body contains:

```json
{ "status": "approved" }
```

the route persists:

```json
{ "status": "scheduled" }
```

Other patch fields such as `body` and `memo` are preserved.

## UI Contract

When the selected post has a planned publishing slot, clicking `承認する` sends `status: scheduled` and shows feedback that the post has been approved and scheduled.

## Verification

- `tests/server/routes/sns-growth.test.js`
- `tests/ui/views/sns-growth-cockpit-view.test.js`
- `tests/e2e/sns-growth-cockpit.spec.js`
- `tests/sns/ops/run-sns-scheduled-posts.test.js`
