# VibePro Brainbase Evaluation Report: vibepro-brainbase-20260510-inbox-pending-removal

## 対象

`_inbox/pending.md` を Brainbase runtime から使わないようにする変更。

今回の判断は、Inbox UI 全体の削除ではなく、file-backed notification source の廃止に限定する。Learning candidate と learning health alert は引き続き Inbox UI に表示する。

## 影響レビュー

### 削除した経路

- `server.js` の `INBOX_FILE = BRAINBASE_ROOT/_inbox/pending.md`
- `server/bootstrap/core-services.js` の `InboxParser` 生成
- `server/bootstrap/register-api-routes.js` の `/api/inbox` 登録
- `server/routes/inbox.js`
- `server/controllers/inbox-controller.js`
- `lib/inbox-parser.js`
- `tests/unit/inbox-parser.test.js`
- UI の `/api/inbox/pending` 読み込み
- UI の file-backed 通知表示、Slack mention 変換、確認済み操作
- `INBOX_ITEM_COMPLETED` event

### 残した経路

- `InboxService.loadInbox()` は `/api/learning/promotions?status=evaluated&apply_mode=manual` と `/api/learning/health` を読む
- `InboxView` は learning candidate と health alert を描画する
- `INBOX_LOADED` event は残す

### 残参照

runtime / test / command / current architecture docs からは `_inbox/pending.md`, `/api/inbox`, `InboxParser`, `inboxParser`, `INBOX_ITEM_COMPLETED` を除去済み。

残った参照は次だけ。

- `docs/internal/MIGRATION_2025-12-31.md`: historical migration doc
- `.gitignore`: ignored runtime/private file pattern

## 実行証跡

- `npx vitest run tests/domain/inbox/inbox-service.test.js tests/ui/views/inbox-view.test.js tests/api/server-endpoints.test.js` -> 31 passed
- `npx eslint server.js server/bootstrap/core-services.js server/bootstrap/register-api-routes.js public/modules/core/event-bus.js public/modules/domain/inbox/inbox-service.js public/modules/ui/views/inbox-view.js tests/domain/inbox/inbox-service.test.js tests/ui/views/inbox-view.test.js tests/api/server-endpoints.test.js tests/setup/test-setup.js` -> passed
- `git diff --check` -> passed
- worktree temporary server on `31014`: `/api/inbox/pending` returned `404`
- `node scripts/vibepro-score-run.mjs auto-run docs/internal/vibepro-dogfood/runs/vibepro-brainbase-20260510-inbox-pending-removal` -> scored

## 判定

`_inbox/pending.md` の runtime 使用廃止は完了。Inbox UI の現行用途である Learning / health 通知は維持している。

## 残リスク

- 現在の `localhost:31013` は `/Users/ksato/workspace/code/brainbase` から起動中で、この worktree の変更はまだ反映されていない
- worktree には terminal/input 系の既存 dirty changes が残っているため、この run の observation には unrelated dirty files が検出されている

## 評価分離

`diagnosis.json` は VibePro の判断、`outcome.json` は機械観測から生成した事後事実、`labels.json` は両者の照合結果として扱う。

## 指標

- 本番化ギャップ捕捉率: 1
- 本番化ギャップ的中率: 1
- ゲート違反流出率: 0

## 判定

評価分離ループは採点まで完了した。
