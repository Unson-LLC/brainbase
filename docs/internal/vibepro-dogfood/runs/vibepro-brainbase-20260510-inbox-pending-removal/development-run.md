# VibePro Autonomous Development Run: Inbox Pending Removal

## Request

`_inbox/pending.md` を使わないようにする。

## Loop

```text
runtime/file-backed Inbox の現状確認
-> server / UI / command docs の影響範囲分離
-> file-backed notification source の削除
-> Learning / health Inbox の維持
-> tests / lint / grep / temporary server route check
-> VibePro report and development DAG evidence
```

## Implementation

- jj change: `xswrkxzv`
- commit: pending
- description: `remove file-backed _inbox/pending.md runtime path`

Changed runtime files:

- `server.js`
- `server/bootstrap/core-services.js`
- `server/bootstrap/register-api-routes.js`
- `server/routes/inbox.js`
- `server/controllers/inbox-controller.js`
- `lib/inbox-parser.js`
- `public/modules/domain/inbox/inbox-service.js`
- `public/modules/ui/views/inbox-view.js`
- `public/modules/core/event-bus.js`

## Behavior Changed

- `BRAINBASE_ROOT/_inbox/pending.md` is no longer a runtime source.
- `/api/inbox` is no longer registered.
- UI no longer calls `/api/inbox/pending`.
- UI no longer renders file-backed notification items or done buttons.
- Learning candidate and learning health alert Inbox sections remain active.
- Legacy commands no longer instruct agents to append to `_inbox/pending.md`.

## Verification

Passed:

- `npx vitest run tests/domain/inbox/inbox-service.test.js tests/ui/views/inbox-view.test.js tests/api/server-endpoints.test.js` -> 31 passed
- `npx eslint server.js server/bootstrap/core-services.js server/bootstrap/register-api-routes.js public/modules/core/event-bus.js public/modules/domain/inbox/inbox-service.js public/modules/ui/views/inbox-view.js tests/domain/inbox/inbox-service.test.js tests/ui/views/inbox-view.test.js tests/api/server-endpoints.test.js tests/setup/test-setup.js`
- `git diff --check`
- residual reference grep: only historical migration doc and `.gitignore`
- temporary server on `31014`: `/api/inbox/pending` returned `404`
- `node scripts/vibepro-score-run.mjs auto-run docs/internal/vibepro-dogfood/runs/vibepro-brainbase-20260510-inbox-pending-removal`
- `report.html` generated as the human-facing VibePro impact report

## Judgment

`targeted_success`.

The removed path is scoped to file-backed Inbox notifications. The current Inbox surface remains available for Learning candidates and health alerts. This is the correct split: delete the obsolete storage source without deleting the active notification UI.

## Residual Risk

- `localhost:31013` is currently serving another checkout, so this worktree change is not live there yet.
- The working copy has unrelated terminal/input dirty files that need separation before commit/merge.
