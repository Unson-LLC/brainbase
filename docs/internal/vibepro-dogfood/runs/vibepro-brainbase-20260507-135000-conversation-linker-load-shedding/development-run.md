# VibePro Autonomous Development Run: ConversationLinker Load Shedding

## Request

`CSRF連打以外に重たい原因をVibeProのストーリーを作って解消できる？`

## Interpreted Goal

Loki分析で見つかったCSRF以外の重い処理を、VibeProのStory-to-Ship証跡付きで軽量化する。

## Findings

- `ConversationLinker` は5分周期で Codex session index を作る。
- `~/.codex/sessions` は 2925 jsonl / 複数GB 規模まで増えていた。
- 既存実装は index cache TTL が切れるたび、各 jsonl の先頭を読み直して cwd を取得していた。
- `Hook Received status update` と `ActivityWs broadcast` は heartbeat ごとに info ログを出し、Loki ingest を増やしていた。

## Implementation

- Codex file metadata cache を `ConversationLinker` に追加。
- `filePath + size + mtimeMs` が同じ jsonl は cached cwd を使い、本文を開かない。
- 更新された jsonl だけ cwd を読み直す。
- heartbeat / ActivityWs broadcast のログを `debug` に変更。

## Verification

Passed:

- `npm -s exec vitest run tests/server/services/conversation-linker.test.js tests/unit/session-activity-ws-service.test.js tests/unit/activity-service-methods.test.js`
- `npx eslint server/services/conversation-linker.js server/services/session-activity-ws-service.js server/services/session-core/activity-service-methods.js tests/server/services/conversation-linker.test.js tests/unit/session-activity-ws-service.test.js tests/unit/activity-service-methods.test.js`
- Real cache benchmark: first index `2925` cwd reads / `21961ms`; second index after forced index-cache expiry `0` cwd reads / `322ms`.

## Residual Risks

- runtime serverへの反映後にLokiで1時間窓のログ量を再測定する必要がある。
- process restart 直後の初回 index 構築は、既存 jsonl を一度読む。
