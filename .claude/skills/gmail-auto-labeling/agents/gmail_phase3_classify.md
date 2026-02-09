---
name: phase3-classify
description: email-classifier Skill（LLM版）を使って各メールを分類。brainbase連携・Label名→ID変換を実施。
tools: [Read, Write, Skill]
skills: [email-classifier]
mcp: [brainbase]
model: claude-haiku-4-5-20251001
---

# Phase 3: 分類実行（LLM版）

## Purpose

email-classifier Skill（LLM版）を使って各メールを分類し、適用すべきラベルIDを決定。

**変更点（LLM版）**:
- availableLabels を email-classifier に渡す
- brainbaseContext をオプションで取得・渡す
- LLM出力（urgency, needsReply, reasoning）を処理
- matchedRuleIds削除（LLM推論では不要）

## Input

- `fetched_messages.json`: Phase 2の出力（各アカウントのメール一覧）
- `label_validation.json`: Phase 1の出力（Label名→ID変換マップ）

## Process

### Step 1: Phase 2のメールリスト読み込み

```bash
Read: /tmp/gmail-auto-labeling/fetched_messages.json
Read: /tmp/gmail-auto-labeling/label_validation.json
```

### Step 2: availableLabels準備

Phase 1の`label_validation.json`から各アカウントの`existingLabelIds`のキー一覧を取得：

```javascript
// 擬似コード
const availableLabels = {};
for (account in ["unson", "salestailor", "techknight"]) {
  availableLabels[account] = Object.keys(label_validation[account].existingLabelIds);
  // 例: ["dev/github", "dev/pr", "finance/invoice"]
}
```

### Step 3: 各メールに対してemail-classifier呼び出し（LLM版）

全アカウント・全メールに対してループ：

```javascript
// 擬似コード
for (account in ["unson", "salestailor", "techknight"]) {
  for (message in fetched_messages[account]) {
    // brainbaseContext取得（オプション）
    let brainbaseContext = null;
    try {
      const accountRaci = await brainbase.get_entity({ type: "org", id: account });
      const relatedPerson = await brainbase.get_context({ topic: message.from });

      brainbaseContext = {
        accountRaci,
        relatedPerson: relatedPerson.primary_entity || null,
        relatedProjects: relatedPerson.related_entities?.projects || []
      };
    } catch (error) {
      // brainbase連携失敗時は null のまま継続
      console.warn(`brainbase context fetch failed: ${error.message}`);
    }

    // email-classifier Skill呼び出し（LLM版）
    const result = await Skill("email-classifier", {
      message: {
        from: message.from,
        subject: message.subject,
        body: message.body,
        date: message.date
      },
      accountId: account,
      availableLabels: availableLabels[account],  // 追加
      brainbaseContext  // 追加（nullの場合もある）
    });

    // 結果を記録（LLM版の新フィールド含む）
    classification_results[account][message.id] = {
      addLabelNames: result.addLabelNames,  // Label名（まだID変換前）
      removeLabelIds: result.removeLabelIds,  // システムラベルID
      urgency: result.urgency,  // 新規: 1-5
      needsReply: result.needsReply,  // 新規: boolean
      reasoning: result.reasoning,  // 新規: LLMの判断理由
      actions: result.actions
    };
  }
}
```

### Step 4: Label名→Label ID変換

`label_validation.json`の`existingLabelIds`マップを使って変換：

```javascript
// 擬似コード
for (account in classification_results) {
  const labelMap = label_validation[account].existingLabelIds;

  for (messageId in classification_results[account]) {
    const result = classification_results[account][messageId];
    const addLabelIds = [];

    // Label名→Label ID変換
    for (labelName of result.addLabelNames) {
      if (labelMap[labelName]) {
        addLabelIds.push(labelMap[labelName]);
      } else {
        console.warn(`Label not found: ${labelName} (skipping)`);
      }
    }

    result.addLabelIds = addLabelIds;  // Label ID配列に置き換え
    delete result.addLabelNames;
  }
}
```

### Step 5: 結果JSON出力

```bash
Write: /tmp/gmail-auto-labeling/classification_results.json
```

## Output Format

```json
{
  "unson": {
    "19b9589e196074fa": {
      "addLabelIds": ["Label_123", "Label_456"],
      "removeLabelIds": ["INBOX"],
      "urgency": 2,
      "needsReply": false,
      "reasoning": "GitHub PR通知。開発関連だが緊急性は低い。自動通知なので返信不要。",
      "actions": {
        "archive": false,
        "markAsRead": false
      }
    },
    "abc456": {
      "addLabelIds": ["Label_789"],
      "removeLabelIds": ["INBOX", "UNREAD"],
      "urgency": 1,
      "needsReply": false,
      "reasoning": "広告メール。spam/promoに分類。緊急度は最低、返信不要。既読＋アーカイブ。",
      "actions": {
        "archive": true,
        "markAsRead": true
      }
    }
  },
  "salestailor": {
    "xyz789": {
      "addLabelIds": [],
      "removeLabelIds": [],
      "urgency": 3,
      "needsReply": true,
      "reasoning": "初回問い合わせ。返信が必要だがラベルマッチなし。",
      "actions": {
        "archive": false,
        "markAsRead": false
      }
    }
  },
  "techknight": {
    "def012": {
      "addLabelIds": ["Label_456"],
      "removeLabelIds": ["INBOX"],
      "urgency": 2,
      "needsReply": false,
      "reasoning": "Vercelデプロイ通知。開発関連、緊急性なし。",
      "actions": {
        "archive": false,
        "markAsRead": false
      }
    }
  }
}
```

## Success Criteria

- [✅] SC-1: 全メール分類完了（LLM推論成功）
- [✅] SC-2: Label名→Label ID変換成功
- [✅] SC-3: 不足ラベル警告（存在しないLabel IDはスキップ）
- [✅] SC-4: brainbaseContext取得試行（失敗時はnullで継続）
- [✅] SC-5: 分類サマリー出力（urgency別・needsReply別集計含む）

## Output to Orchestrator

**成功時**:
```
✅ Phase 3完了
- unson: 100件分類
  - 緊急度5: 5件（要返信: 4件）
  - 緊急度4: 10件（要返信: 8件）
  - 緊急度3: 20件（要返信: 5件）
  - 緊急度2: 40件（要返信: 0件）
  - 緊急度1: 25件（要返信: 0件）
  - ラベル付与: 85件
  - ラベルなし: 15件
- salestailor: 85件分類
  - 緊急度5: 3件（要返信: 3件）
  - 緊急度4: 12件（要返信: 10件）
  - ラベル付与: 70件
  - ラベルなし: 15件
- techknight: 100件分類
  - 緊急度2: 60件（要返信: 0件）
  - 緊急度1: 30件（要返信: 0件）
  - ラベル付与: 90件
  - ラベルなし: 10件

総分類件数: 285件（ラベル付与: 245件、なし: 40件）

⚠️ 不足ラベル警告:
- unson: spam/promo (2件スキップ)
- salestailor: dev/github (10件スキップ)

⚠️ brainbaseContext取得失敗: 5件（分類は継続）

Output: /tmp/gmail-auto-labeling/classification_results.json
```

**失敗時（email-classifier Skill呼び出しエラー）**:
```
❌ Phase 3失敗
- email-classifier Skill呼び出しエラー（unson: message abc123）

→ Phase 3を再実行（Max 3回）
```

## Implementation Notes

### email-classifier Skill呼び出し（LLM版）

実際のSkill呼び出しは、Orchestratorが`Skill`ツールを使って実行：

```markdown
Skill: email-classifier

Input:
- message:
    from: "notifications@github.com"
    subject: "Pull Request #123 opened"
    body: "A new PR has been opened..."
    date: "2026-01-03T10:00:00Z"
- accountId: "unson"
- availableLabels: ["dev/github", "dev/pr", "finance/invoice"]
- brainbaseContext:
    accountRaci: { entity: "UNSON", ceo: "佐藤圭吾" }
    relatedPerson: null
    relatedProjects: []
```

### brainbaseContext取得

**目的**: 送信者情報・プロジェクト情報を元にLLMの分類精度向上

**取得順序**:
1. `brainbase.get_entity({ type: "org", id: account })` → アカウントRACI情報
2. `brainbase.get_context({ topic: message.from })` → 送信者に関連するPerson/Project

**失敗時の扱い**:
- brainbase MCP接続失敗 → `brainbaseContext: null` で継続
- 該当エンティティ不在 → `relatedPerson: null` で継続
- 警告ログ出力のみ、分類は中断しない

### Label ID変換の重要性

email-classifierはLabel名（例: `dev/github`）を返すが、Gmail APIはLabel ID（例: `Label_123`）を要求する。Phase 3でこの変換を実施。

### ラベルなしの扱い

- LLMが`addLabelNames: []`と判断したメール → `addLabelIds: []`, `removeLabelIds: []`
- Phase 4でスキップ（ラベル操作不要）
- **重要**: `needsReply: true`の場合は別途返信下書き生成タスクへ

### 不足ラベルの扱い

- `label_validation.json`に存在しないラベル名 → 警告 + スキップ
- 該当メールは`addLabelIds`に含まれない

### エラーハンドリング

- **email-classifier Skill失敗**: 該当メールをスキップ、警告記録
- **LLMレスポンス不正**: email-classifier側でデフォルト値（urgency=3, needsReply=false）
- **brainbaseContext取得失敗**: null として分類継続
- **メール本文取得失敗**: 空文字列として分類実行

## Example Execution

### Input

**fetched_messages.json** (抜粋):
```json
{
  "unson": [
    {
      "id": "19b9589e196074fa",
      "from": "notifications@github.com",
      "subject": "Pull Request #123 opened",
      "body": "A new PR has been opened...",
      "date": "2026-01-03T10:00:00Z",
      "labelIds": ["INBOX", "UNREAD"]
    }
  ]
}
```

**label_validation.json** (抜粋):
```json
{
  "unson": {
    "existingLabelIds": {
      "dev/github": "Label_123",
      "dev/pr": "Label_456",
      "finance/invoice": "Label_789"
    },
    "missingLabels": ["spam/promo"]
  }
}
```

### Process Log

```
[Phase 3] Starting Classification (LLM版)...
[Phase 3] Loading fetched messages...
[Phase 3] Loading label validation results...

[Phase 3] Preparing availableLabels...
[Phase 3]   unson: ["dev/github", "dev/pr", "finance/invoice"]
[Phase 3]   salestailor: ["project/crm", "finance/invoice"]
[Phase 3]   techknight: ["dev/github", "dev/vercel"]

[Phase 3] Classifying unson messages (100 total)...
[Phase 3] unson: message 1/100 (19b9589e196074fa)...
[Phase 3]   Fetching brainbaseContext...
[Phase 3]     accountRaci: UNSON (CEO: 佐藤圭吾)
[Phase 3]     relatedPerson: null
[Phase 3]   Calling email-classifier Skill (LLM)...
[Phase 3]   LLM Response:
[Phase 3]     addLabelNames: ["dev/github", "dev/pr"]
[Phase 3]     urgency: 2
[Phase 3]     needsReply: false
[Phase 3]     reasoning: "GitHub PR通知。開発関連だが緊急性は低い。自動通知なので返信不要。"
[Phase 3]   Converting to Label IDs: Label_123, Label_456
[Phase 3]   ✅ Classified

[Phase 3] unson: message 2/100...
[Phase 3]   Fetching brainbaseContext...
[Phase 3]     ⚠️ brainbase MCP connection failed (continuing with null)
[Phase 3]   Calling email-classifier Skill (LLM)...
[Phase 3]   LLM Response:
[Phase 3]     addLabelNames: ["spam/promo"]
[Phase 3]     urgency: 1
[Phase 3]     needsReply: false
[Phase 3]   ⚠️ Label not found: spam/promo (skipping)
[Phase 3]   ✅ Classified (no labels to apply)

[Phase 3] unson: 100/100 completed
[Phase 3]   緊急度5: 5件（要返信: 4件）
[Phase 3]   緊急度4: 10件（要返信: 8件）
[Phase 3]   緊急度3: 20件（要返信: 5件）
[Phase 3]   緊急度2: 40件（要返信: 0件）
[Phase 3]   緊急度1: 25件（要返信: 0件）

[Phase 3] Classifying salestailor messages (85 total)...
[Phase 3] salestailor: 85/85 completed

[Phase 3] Classifying techknight messages (100 total)...
[Phase 3] techknight: 100/100 completed

[Phase 3] Writing results to /tmp/gmail-auto-labeling/classification_results.json
[Phase 3] ✅ Complete (285 messages classified)
```

### Output

**classification_results.json**:
```json
{
  "unson": {
    "19b9589e196074fa": {
      "addLabelIds": ["Label_123", "Label_456"],
      "removeLabelIds": ["INBOX"],
      "urgency": 2,
      "needsReply": false,
      "reasoning": "GitHub PR通知。開発関連だが緊急性は低い。自動通知なので返信不要。",
      "actions": {
        "archive": false,
        "markAsRead": false
      }
    }
  },
  "salestailor": {},
  "techknight": {}
}
```

## Performance Considerations

### LLM呼び出しコスト（新規）

- **Model**: sonnet（email-classifier側で指定）
- **推定コスト**: ~$0.003/メール
- **300件処理**: ~$0.90
- **従来のYAMLルール**: $0（無料）

**コスト最適化策**:
- 本文を2000文字に制限（email-classifier側で実装）
- brainbaseContextは必要最小限
- Batch処理は行わない（1メール = 1推論）

### 処理時間

- **LLM推論**: ~1-2秒/メール
- **brainbaseContext取得**: ~200ms/メール（オプション）
- **Label ID変換**: <1秒（全体）
- **300件処理**: 約5-10分（従来: 数秒）

**時間最適化策**:
- 並列処理（将来検討）
- プロンプト最適化（簡潔に）

### email-classifier呼び出し回数
- 最大300回（100件/アカウント × 3アカウント）
- 各呼び出し: ~1-2秒（LLM推論含む）
- 合計: 約5-10分

## Migration from YAML Rules

### 削除されたフィールド
- ❌ `matchedRuleIds`: LLM推論では不要

### 追加されたフィールド
- ✅ `urgency`: 1-5（緊急度）
- ✅ `needsReply`: boolean（返信必要性）
- ✅ `reasoning`: string（LLMの判断理由）

### 動作変更
- YAML rule matching → LLM inference
- 高速（数秒） → 低速（5-10分）
- コスト無料 → 有料（~$0.90/300件）
- 精度: ルールベース → コンテキスト理解
