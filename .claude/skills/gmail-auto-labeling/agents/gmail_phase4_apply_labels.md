---
name: phase4-apply-labels
description: gmail_modify_labelsを使って各メールにラベル適用。Rate Limit対策済み。成功率90%以上を目標。
tools: [Read, Write, Bash]
skills: []
model: claude-haiku-4-5-20251001
---

# Phase 4: ラベル適用

## Purpose

gmail_modify_labelsを使って、Phase 3の分類結果に基づき各メールにラベルを適用。

## Input

- `classification_results.json`: Phase 3の出力（各メールの分類結果）

## Process

### Step 1: Phase 3の分類結果読み込み

```bash
Read: /tmp/gmail-auto-labeling/classification_results.json
```

### Step 2: 各メールに対してgmail_modify_labels呼び出し

全アカウント・全メールに対してループ：

```javascript
// 擬似コード
const results = {
  success: [],
  failed: []
};

for (account in classification_results) {
  for (messageId in classification_results[account]) {
    const classification = classification_results[account][messageId];

    // ラベル操作が不要なメールはスキップ
    if (classification.addLabelIds.length === 0 &&
        classification.removeLabelIds.length === 0) {
      console.log(`Skipping ${messageId} (no labels to apply)`);
      continue;
    }

    try {
      // gmail_modify_labels呼び出し
      await gmail_modify_labels({
        account: account,
        messageId: messageId,
        addLabelIds: classification.addLabelIds,
        removeLabelIds: classification.removeLabelIds
      });

      results.success.push({
        account: account,
        messageId: messageId,
        addedLabels: classification.addLabelIds.length,
        removedLabels: classification.removeLabelIds.length
      });

    } catch (error) {
      results.failed.push({
        account: account,
        messageId: messageId,
        error: error.message
      });
    }
  }
}
```

### Step 3: 成功/失敗カウント

```javascript
const summary = {
  total: results.success.length + results.failed.length,
  success: results.success.length,
  failed: results.failed.length,
  successRate: results.success.length / (results.success.length + results.failed.length)
};
```

### Step 4: 結果JSON出力

```bash
Write: /tmp/gmail-auto-labeling/apply_results.json
```

## Output Format

```json
{
  "summary": {
    "total": 285,
    "success": 270,
    "failed": 15,
    "successRate": 0.947
  },
  "byAccount": {
    "unson": {
      "success": 95,
      "failed": 5
    },
    "salestailor": {
      "success": 80,
      "failed": 5
    },
    "techknight": {
      "success": 95,
      "failed": 5
    }
  },
  "failedMessages": [
    {
      "account": "unson",
      "messageId": "xyz789",
      "error": "Label not found: Label_999"
    },
    {
      "account": "salestailor",
      "messageId": "abc123",
      "error": "Message not found"
    }
  ]
}
```

## Success Criteria

- [✅] SC-1: 全分類結果にラベル適用試行
- [✅] SC-2: 成功率90%以上
- [✅] SC-3: 失敗メッセージID記録
- [✅] SC-4: Rate Limit対策動作（retryWithBackoff）

## Output to Orchestrator

**成功時（成功率90%以上）**:
```
✅ Phase 4完了
- 総メール数: 285件
- 成功: 270件（94.7%）
- 失敗: 15件（5.3%）

アカウント別:
- unson: 95/100 成功
- salestailor: 80/85 成功
- techknight: 95/100 成功

Output: /tmp/gmail-auto-labeling/apply_results.json
```

**警告時（成功率50-90%）**:
```
⚠️ Phase 4完了（成功率低下）
- 総メール数: 285件
- 成功: 200件（70.2%）
- 失敗: 85件（29.8%）

→ Phase 5へ進行（レポートに失敗詳細を含める）
```

**失敗時（成功率50%未満）**:
```
❌ Phase 4失敗（成功率50%未満）
- 総メール数: 285件
- 成功: 100件（35.1%）
- 失敗: 185件（64.9%）

主なエラー:
- 429 Too Many Requests: 150件
- Label not found: 35件

→ Phase 4を再実行（Max 3回）
```

## Implementation Notes

### gmail_modify_labels呼び出し

```bash
# 実際のMCP呼び出し
mcp__gmail__gmail_modify_labels(
  account: "unson",
  messageId: "19b9589e196074fa",
  addLabelIds: ["Label_123", "Label_456"],
  removeLabelIds: ["INBOX"]
)
```

### Rate Limit対策

Gmail MCP側で`retryWithBackoff`実装済み：
- 429エラー発生 → 1秒待機 → リトライ
- 再度429エラー → 2秒待機 → リトライ
- 再度429エラー → 4秒待機 → リトライ
- 3回失敗 → エラー記録

### スキップ条件

以下のメールはスキップ：
1. `addLabelIds: []` かつ `removeLabelIds: []`
2. Phase 3でルールマッチなし

### エラーハンドリング

| エラー | 対処 |
|--------|------|
| **429 Too Many Requests** | retryWithBackoff（自動） |
| **404 Message not found** | スキップ、警告記録 |
| **400 Label not found** | スキップ、警告記録 |
| **401/403 Unauthorized** | 即座に人間へエスカレーション |

### 成功率の判定基準

- **90%以上**: 正常終了
- **50-90%**: 警告 + Phase 5へ進行
- **50%未満**: Critical → Phase 4再実行（Max 3回）

## Example Execution

### Input

**classification_results.json** (抜粋):
```json
{
  "unson": {
    "19b9589e196074fa": {
      "addLabelIds": ["Label_123", "Label_456"],
      "removeLabelIds": ["INBOX"],
      "actions": {
        "archive": false,
        "markAsRead": false
      },
      "matchedRuleIds": ["github-pr"]
    },
    "abc456": {
      "addLabelIds": [],
      "removeLabelIds": [],
      "actions": {
        "archive": false,
        "markAsRead": false
      },
      "matchedRuleIds": []
    }
  }
}
```

### Process Log

```
[Phase 4] Starting Label Application...
[Phase 4] Loading classification results...
[Phase 4] Found 285 messages to process

[Phase 4] Processing unson (100 messages)...
[Phase 4] unson: message 1/100 (19b9589e196074fa)...
[Phase 4]   Adding labels: Label_123, Label_456
[Phase 4]   Removing labels: INBOX
[Phase 4]   Calling gmail_modify_labels...
[Phase 4]   ✅ Success

[Phase 4] unson: message 2/100 (abc456)...
[Phase 4]   No labels to apply (skipping)

[Phase 4] unson: message 3/100 (xyz789)...
[Phase 4]   Adding labels: Label_999
[Phase 4]   Calling gmail_modify_labels...
[Phase 4]   ❌ Error: Label not found: Label_999
[Phase 4]   Recording failure...

[Phase 4] unson: 100 messages processed (95 success, 5 failed)

[Phase 4] Processing salestailor (85 messages)...
[Phase 4] salestailor: 85 messages processed (80 success, 5 failed)

[Phase 4] Processing techknight (100 messages)...
[Phase 4] techknight: 100 messages processed (95 success, 5 failed)

[Phase 4] Summary:
[Phase 4]   Total: 285
[Phase 4]   Success: 270 (94.7%)
[Phase 4]   Failed: 15 (5.3%)

[Phase 4] Writing results to /tmp/gmail-auto-labeling/apply_results.json
[Phase 4] ✅ Complete (success rate: 94.7% > 90%)
```

### Output

**apply_results.json**:
```json
{
  "summary": {
    "total": 285,
    "success": 270,
    "failed": 15,
    "successRate": 0.947
  },
  "byAccount": {
    "unson": {
      "success": 95,
      "failed": 5
    },
    "salestailor": {
      "success": 80,
      "failed": 5
    },
    "techknight": {
      "success": 95,
      "failed": 5
    }
  },
  "failedMessages": [
    {
      "account": "unson",
      "messageId": "xyz789",
      "error": "Label not found: Label_999"
    },
    {
      "account": "unson",
      "messageId": "def012",
      "error": "Message not found"
    },
    {
      "account": "salestailor",
      "messageId": "ghi345",
      "error": "Label not found: Label_888"
    }
    // ... 12 more failures
  ]
}
```

## Performance Considerations

### Expected Execution Time

- **gmail_modify_labels**: ~500ms/メール（Rate Limit考慮）
- **Total**: 約150秒（300件の場合）

### Rate Limit管理

Gmail API Quota制限：
- `users.messages.modify`: 5 units/call
- User quota: 250 units/second
- → 約50メール/秒が理論上限

実際の処理速度：
- retryWithBackoff考慮: 約2メール/秒
- 300件の処理: 約150秒（2.5分）

### 最適化戦略

- Phase 4では順次実行（Rate Limit対策）
- retryWithBackoffによる自動スロットリング
- 失敗メッセージは即座にスキップ（無限ループ防止）

## Review & Replan Considerations

### Critical条件（Phase 4再実行）

- 成功率50%未満
- 認証エラー（401/403）多発
- ネットワークエラー多発

### Minor条件（警告+進行）

- 成功率50-90%
- Label not found警告（一部ラベル不足）
- Message not found警告（一部メール削除済み）

### None条件（正常終了）

- 成功率90%以上
- 失敗メッセージが既知のエラー（Label/Message not found）のみ
