# UNS-333: Show the newest 50 meetings before reading older pages

Story: A reader sees the first page of the archive promptly and explicitly loads older meetings.

Spec / acceptance:
- The common UI requests `limit=50`, renders the first response immediately, and follows `next_cursor` only after “もっと見る”.
- Paged core summaries sort by meeting date descending, followed by undated imports by creation time descending. Equal timestamps use a deterministic meeting ID tie-breaker. The legacy unpaged array contract remains unchanged.
- Loading another page preserves existing rows and details on failure, allows retry, and suppresses concurrent duplicate requests. Refresh restarts at the first page; stale responses cannot overwrite it.
- While pages remain, search/filter/sort apply to loaded rows and the UI states this scope. A filtered empty page must retain the continuation control.
- Permissions, body-free summaries, mutation readback and invalid-cursor failures remain enforced. No migration or deployment.

Impact: `ui/meeting-minutes.js`, core `listMeetingsPage`, HTTP adapters passing existing limit/cursor. Organization BFF already forwards these parameters. No installed Graphify index was found; cross-repository runtime timing remains unverified. The store still reads the canonical snapshot and checks ACLs; this change bounds summary rendering and response traversal, not the snapshot storage cost.

Delivery: upstream PR only. npm publication and host version-pin rollout require a separate approved release; the production vendor is not changed by this PR.

Verification: `npm run build` passed; `npx vitest run tests/meeting-minutes*.test.ts tests/ui/meeting-minutes*.test.mjs --maxWorkers=4` passed (18 files, 156 tests), covering bounded paging, newest-first membership, insertion between pages, ACL filtering, first-page render, on-demand continuation, retry, duplicate-click suppression, stale responses, filtered emptiness, cursor repetition and access denial, malformed entries and invalid-cursor recovery.
