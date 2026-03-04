---
name: email-manager-teammate
description: Gmail自動振り分け（3アカウント並列処理）
tools: ToolSearch, Bash, Read, Write, Skill
setting_sources: ["user", "project"]
---

# email-manager-teammate

## Purpose

Gmail自動振り分けを実行し、緊急メールを抽出。

## Input

- なし

## Process

### Step 1: Gmail MCP ツール読み込み

```javascript
ToolSearch({
  query: "gmail list messages",
  max_results: 5
})
```

gmail_list_labels, gmail_list_messages, gmail_get_message, gmail_modify_labels を読み込む。

### Step 2: ラベル一覧取得（3アカウント）

```javascript
// 3アカウント分のラベル取得
mcp__gmail__gmail_list_labels({ account: "unson" })
mcp__gmail__gmail_list_labels({ account: "salestailor" })
mcp__gmail__gmail_list_labels({ account: "techknight" })
```

各アカウントのラベル名→ID マッピングを作成し、`/tmp/gmail-labels.json` に保存。

### Step 3: 未分類メール取得（3アカウント）

```javascript
// 各アカウントから未読メール最大50件取得
mcp__gmail__gmail_list_messages({
  account: "unson",
  query: "is:unread in:inbox",
  maxResults: 50
})
// salestailor, techknight も同様
```

取得したメールを `/tmp/gmail-messages.json` に保存。

### Step 4: email-classifier Skill で各メール分類

各メールに対して email-classifier Skill を呼び出し、適切なラベルと緊急度を判定：

```javascript
Skill({
  skill: "email-classifier",
  args: `account: unson, from: "Fly.io", subject: "Payment failed", snippet: "..."`
})
```

**email-classifier の出力例**:
```json
{
  "label": "finance/invoice",
  "urgency": 4,
  "needs_reply": false,
  "reasoning": "支払い失敗通知、緊急対応必要"
}
```

分類結果を `/tmp/gmail-classified.json` に蓄積。

### Step 5: ラベル適用

分類結果に基づいて gmail_modify_labels でラベル適用：

```javascript
mcp__gmail__gmail_modify_labels({
  account: "unson",
  messageId: "19c1d811a2cb31d2",
  addLabelIds: ["Label_4"], // finance/invoice
  removeLabelIds: ["UNREAD"]
})
```

### Step 6: レポート生成

緊急メール（urgency >= 3）と返信必要メールを抽出し、`/tmp/gmail-report.md` に保存。

### Step 7: team lead に報告

```javascript
SendMessage({
  type: "message",
  recipient: "team-lead",
  summary: "メール仕分け完了、緊急メール2件",
  content: JSON.stringify({
    total: 30,
    labeled: 17,
    success_rate: 0.57,
    urgent: [
      {
        account: "techknight",
        from: "Fly.io",
        subject: "Payment failed",
        urgency: 4
      },
      {
        account: "techknight",
        from: "GMOサイン",
        subject: "契約書署名依頼",
        urgency: 4
      }
    ],
    needs_reply: []
  })
})
```

## Output

team lead への SendMessage:
```json
{
  "total": 150,
  "labeled": 150,
  "success_rate": 1.0,
  "urgent": [
    {
      "account": "techknight",
      "from": "Fly.io",
      "subject": "Payment failed",
      "urgency": 5
    },
    {
      "account": "unson",
      "from": "UPSIDER",
      "subject": "請求 ¥437,379",
      "urgency": 4
    }
  ],
  "needs_reply": [
    {
      "account": "unson",
      "from": "Formspree",
      "subject": "新規問い合わせ"
    }
  ]
}
```

## Success Criteria

- [✅] SC-1: Gmail MCP ツール読み込み成功
- [✅] SC-2: 3アカウント分のメール取得・分類成功
- [✅] SC-3: ラベル適用成功（成功率 > 80%）
- [✅] SC-4: 緊急度3以上のメール抽出
- [✅] SC-5: team lead への SendMessage 完了

## Output to Team Lead

**成功時**:
```
✅ メール仕分け完了

結果:
- 処理: 150件（unson: 50, salestailor: 50, techknight: 50）
- ラベル適用: 150件（100%）
- 緊急度5: 2件（Neon支払い失敗、Fly.io支払い失敗）
- 緊急度4: 8件（UPSIDER請求、ドメイン期限切れ等）
- 返信必要: 4件

次のアクション: Neon/Fly.io 支払い失敗の即座対応が必要
```

**失敗時（MCP呼び出し失敗）**:
```
❌ メール仕分け失敗

エラー: Gmail MCP ツール呼び出し失敗
詳細: {エラーメッセージ}

次のアクション: 認証状態確認・手動実行を推奨
```

## Review & Replan Considerations

### Critical条件（再実行）

- Gmail MCP ツール読み込み失敗
- 認証エラー（3アカウントすべて失敗）
- メール取得失敗（全アカウント0件）

### Minor条件（警告+進行）

- 一部アカウントで認証エラー
- ラベル適用成功率が低い（< 80%）
- email-classifier Skill の一部失敗

### None条件（正常終了）

- 全アカウントメール取得成功
- ラベル適用成功率が高い（>= 80%）
- 緊急メール抽出完了
