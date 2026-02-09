---
name: phase2-fetch-messages
description: 未分類メール（`is:unread` または `in:inbox`）を各アカウントから並列取得。最大100件/アカウント。
tools: [Read, Write, Bash]
skills: []
model: claude-haiku-4-5-20251001
---

# Phase 2: メール取得

## Purpose

未分類メール（`is:unread` または `in:inbox`）を各アカウントから取得し、Phase 3の分類処理に渡す。

## Input

- `label_validation.json`: Phase 1の出力（参照のみ、取得処理には影響しない）
- `maxMessages`: アカウントあたりの最大取得件数（デフォルト: 100）
- `daysLimit`: 取得対象期間（デフォルト: 3日以内）

## Process

### Step 1: Phase 1結果の確認

```bash
Read: /tmp/gmail-auto-labeling/label_validation.json
```

Phase 1で認証エラーが発生したアカウントはスキップ。

### Step 2: 未分類メール取得（並列実行）

3アカウントに対して並列で`gmail_list_messages`を呼び出し：

**重要**: 古いメールが毎日警告されるのを防ぐため、**3日以内**のメールのみ取得する。

```bash
# unsonアカウント（並列1）
mcp__gmail__gmail_list_messages(
  account: "unson",
  query: "(is:unread OR in:inbox) newer_than:3d",
  maxResults: 100
)

# salestailorアカウント（並列2）
mcp__gmail__gmail_list_messages(
  account: "salestailor",
  query: "(is:unread OR in:inbox) newer_than:3d",
  maxResults: 100
)

# techknightアカウント（並列3）
mcp__gmail__gmail_list_messages(
  account: "techknight",
  query: "(is:unread OR in:inbox) newer_than:3d",
  maxResults: 100
)
```

**クエリの説明**:
- `newer_than:3d`: 3日以内のメールのみ取得（古いメールの繰り返し警告を防止）
- `is:unread OR in:inbox`: 未読 or 受信トレイのメール

### Step 3: メール詳細取得

各メールID（最大100件/アカウント）に対して`gmail_get_message`を呼び出し：

```bash
# 各メールの詳細取得
mcp__gmail__gmail_get_message(
  account: "unson",
  messageId: "19b9589e196074fa"
)
```

取得する情報：
- `id`: メッセージID
- `threadId`: スレッドID
- `from`: 送信者メールアドレス
- `subject`: 件名
- `body`: 本文（最初の1000文字）
- `labelIds`: 現在のラベルID配列

### Step 4: 結果JSON出力

```bash
Write: /tmp/gmail-auto-labeling/fetched_messages.json
```

## Output Format

```json
{
  "unson": [
    {
      "id": "19b9589e196074fa",
      "threadId": "19b34f1a92439be1",
      "from": "notifications@github.com",
      "subject": "Pull Request #123 opened",
      "body": "A new PR has been opened by user...",
      "labelIds": ["INBOX", "UNREAD"]
    },
    {
      "id": "abc456",
      "threadId": "thread-2",
      "from": "info@vercel.com",
      "subject": "Your deployment succeeded",
      "body": "Your project has been deployed to...",
      "labelIds": ["INBOX"]
    }
  ],
  "salestailor": [
    {
      "id": "xyz789",
      "threadId": "thread-3",
      "from": "client@example.com",
      "subject": "Re: 契約書の件",
      "body": "お世話になっております...",
      "labelIds": ["INBOX", "UNREAD"]
    }
  ],
  "techknight": [
    {
      "id": "def012",
      "threadId": "thread-4",
      "from": "noreply@github.com",
      "subject": "[GitHub] Security alert",
      "body": "A security vulnerability was detected...",
      "labelIds": ["INBOX", "IMPORTANT"]
    }
  ]
}
```

## Success Criteria

- [✅] SC-1: 全アカウントでメール取得成功（0件の場合も成功）
- [✅] SC-2: 各アカウント最大100件取得
- [✅] SC-3: メール詳細（from, subject, body, labelIds）取得完了
- [✅] SC-4: 取得件数サマリー出力

## Output to Orchestrator

**成功時（メールあり）**:
```
✅ Phase 2完了
- unson: 100件取得
- salestailor: 85件取得
- techknight: 100件取得

総メール数: 285件

Output: /tmp/gmail-auto-labeling/fetched_messages.json
```

**成功時（メールなし）**:
```
✅ Phase 2完了
- unson: 0件
- salestailor: 0件
- techknight: 0件

総メール数: 0件

→ Phase 3-5はスキップ（処理対象メールなし）
```

**失敗時（API エラー）**:
```
❌ Phase 2失敗
- unsonアカウント: 429 Too Many Requests（3回リトライ後）

→ Phase 2を再実行（Max 3回）
```

## Implementation Notes

### 並列実行の最適化
- 3アカウント同時に`gmail_list_messages`実行
- 各アカウントのメール詳細取得は順次実行（Rate Limit対策）

### クエリの使い分け
- **is:unread**: 未読メールのみ
- **in:inbox**: 受信トレイのメール（既読含む）
- **newer_than:3d**: 3日以内のメール（古いメールの繰り返し警告を防止）
- **デフォルト**: `(is:unread OR in:inbox) newer_than:3d`

### 本文の取り扱い
- 本文は最初の1000文字のみ取得（トークン節約）
- HTMLタグは除去

### エラーハンドリング
- **401/403エラー**: 即座に人間へエスカレーション
- **429 Rate Limit**: 自動リトライ（retryWithBackoff、最大3回）
- **404 Not Found**: 該当メッセージをスキップ
- **ネットワークエラー**: 最大3回リトライ

### 0件の場合の扱い
- 全アカウントで0件の場合、Phase 3-5はスキップ
- Orchestratorは正常終了（「処理対象メールなし」と報告）

## Example Execution

### Input
```json
{
  "accountIds": ["unson", "salestailor", "techknight"],
  "maxMessages": 100
}
```

### Process Log
```
[Phase 2] Starting Message Fetching...
[Phase 2] Reading Phase 1 results...
[Phase 2] All accounts authenticated successfully

[Phase 2] Fetching messages (parallel)...
[Phase 2] unson: Querying "(is:unread OR in:inbox) newer_than:3d"...
[Phase 2] salestailor: Querying "(is:unread OR in:inbox) newer_than:3d"...
[Phase 2] techknight: Querying "(is:unread OR in:inbox) newer_than:3d"...

[Phase 2] unson: Found 100 messages
[Phase 2] salestailor: Found 85 messages
[Phase 2] techknight: Found 100 messages

[Phase 2] Fetching message details...
[Phase 2] unson: 1/100...
[Phase 2] unson: 50/100...
[Phase 2] unson: 100/100 ✅

[Phase 2] salestailor: 1/85...
[Phase 2] salestailor: 85/85 ✅

[Phase 2] techknight: 1/100...
[Phase 2] techknight: 100/100 ✅

[Phase 2] Writing results to /tmp/gmail-auto-labeling/fetched_messages.json
[Phase 2] ✅ Complete (285 messages total)
```

### Output
```json
{
  "unson": [
    {
      "id": "19b9589e196074fa",
      "threadId": "19b34f1a92439be1",
      "from": "notifications@github.com",
      "subject": "Pull Request #123 opened",
      "body": "A new PR has been opened by user...",
      "labelIds": ["INBOX", "UNREAD"]
    }
    // ... 99 more messages
  ],
  "salestailor": [
    // ... 85 messages
  ],
  "techknight": [
    // ... 100 messages
  ]
}
```

## Performance Considerations

### Expected Execution Time
- **gmail_list_messages**: ~2秒/アカウント（並列実行）
- **gmail_get_message**: ~0.5秒/メール（順次実行）
- **Total**: 約50-150秒（100-300件の場合）

### Rate Limit
- Gmail API Quota: 250 quota units/user/second
- `gmail_list_messages`: 5 units
- `gmail_get_message`: 5 units
- → 約50リクエスト/秒が上限

### Optimization Strategy
- Phase 2では詳細取得を順次実行（Rate Limit対策）
- Phase 4（ラベル適用）でretryWithBackoffを活用
