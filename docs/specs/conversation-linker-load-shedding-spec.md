---
spec_id: SPEC-005
title: ConversationLinker負荷分散仕様
source_story: docs/stories/STR-005-conversation-linker-load-shedding.md
source_architecture: docs/architecture/ADR-005-conversation-linker-load-shedding.md
status: accepted
created_at: 2026-05-07
updated_at: 2026-05-07
---

# SPEC-005: ConversationLinker負荷分散仕様

## 対象

`server/services/conversation-linker.js`

## Codex index cache

`ConversationLinker` は process-local に Codex jsonl file cache を持つ。

```js
{
  filePath: string,
  size: number,
  mtimeMs: number,
  cwd: string | null
}
```

## `_buildCodexIndex()` の振る舞い

1. `~/.codex/sessions/YYYY/MM/DD/*.jsonl` を列挙する
2. 各 jsonl の `stat.size` と `stat.mtimeMs` を取得する
3. cache に同じ `filePath`, `size`, `mtimeMs` の entry があれば、jsonl 本文を開かず cache の `cwd` を使う
4. cache がない、または `size` / `mtimeMs` が変わった場合だけ `getCodexSessionCwd(filePath)` を実行する
5. `cwd` がある file だけ index に入れる
6. 今回列挙されなかった file の cache entry は捨てる

## ログ

- `ConversationLinker` の開始・完了・エラーは通常ログに残す
- heartbeat ごとの `reportActivity` 受信ログは `debug` とする
- `ActivityWs` の broadcast ログは `debug` とする
- 接続・切断・例外は通常ログに残す

## 受け入れテスト

- 未変更 Codex jsonl は index cache 期限切れ後も `getCodexSessionCwd()` を再実行しない
- Codex jsonl が更新された場合は `getCodexSessionCwd()` を再実行し、変更後 cwd が index に入る
- `linkAll({ limit })` の cursor 挙動は維持される
- `SessionActivityWsService.broadcast()` は接続中 client へ従来通り送信する
