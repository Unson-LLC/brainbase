# Architecture: SNS approval schedules posting

## Story

`str.brainbase.sns-approval-schedules-posting`

## Decision

Keep the SNS Posting Ledger status model unchanged and normalize the approval transition at the API/UI boundary.

## Rationale

The scheduler keeps the status safety boundary: it only publishes posts in `scheduled` status and requires `SNS_AUTO_PUBLISH_ENABLED=true`. The multitenant platform additionally requires a canonical tenant/resource binding on the Ledger row and a successful `background_job` authorization before claim or provider calls. The approval problem remains earlier in the flow: imported posts already carried a planned `scheduled_at`, but the cockpit approve action left them in `approved`, which the scheduled publisher intentionally ignores.

Changing the publisher to scan `approved` would weaken the safety model because approval without a publishing slot could become publishable. Instead:

- the cockpit sends `scheduled` when approving a post that already has a planned slot;
- the API also normalizes `approved` to `scheduled` for scheduled posts, so non-UI callers cannot recreate the dormant state;
- the publisher continues to publish only due `scheduled` posts and now fails closed when tenant binding or the authoritative gateway is unavailable.

## Boundaries

- UI boundary: `public/modules/ui/views/sns-growth-cockpit-view.js`
- API boundary: `server/routes/sns-growth.js`
- Scheduler boundary: `server/services/sns/sns-scheduled-publisher.js` enforces status plus tenant authorization
- Ledger repository status transitions remain unchanged

## Risks

- Historical posts already left in `approved` are not bulk-converted by this change.
- If a past scheduled time is approved after the slot has passed, the existing scheduler semantics will treat it as due on the next run.
