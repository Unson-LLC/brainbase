---
name: phase1-validate-labels
description: 各アカウントのGmailラベル一覧を取得し、Label名→ID変換マップを作成。Phase 3でLLMに渡すためのavailableLabels準備。
tools: [Write]
mcp: [gmail]
model: claude-haiku-4-5-20251001
---

# Phase 1: Label検証（LLM版）

## Purpose

各アカウントのGmailラベル一覧を取得し、Label名→ID変換マップを作成。

**変更点（LLM版）**:
- YAMLルール読み込み廃止
- `existingLabelIds`マップ作成（Label名→ID変換用）
- `missingLabels`削除（LLMがavailableLabelsから選ぶだけ）

## Input

- `accountIds`: 対象アカウントID配列（例: `["unson", "salestailor", "techknight"]`）

## Process

### Step 1: 各アカウントのラベル一覧取得

3アカウントに対して`gmail_list_labels`を呼び出し：

```bash
# unsonアカウント
mcp__gmail__gmail_list_labels(account: "unson")

# salestailorアカウント
mcp__gmail__gmail_list_labels(account: "salestailor")

# techknightアカウント
mcp__gmail__gmail_list_labels(account: "techknight")
```

### Step 2: Label名→ID変換マップ作成

各アカウントで：
1. 取得したラベル一覧から、カスタムラベル（`Label_` または階層構造`xxx/yyy`）のみを抽出
2. Label名 → Label ID のマップを作成
3. `existingLabelIds` オブジェクトに格納

**システムラベルは除外**:
- `INBOX`, `UNREAD`, `SENT`, `DRAFT`, `TRASH`, `SPAM`, `STARRED`, `IMPORTANT`, `CATEGORY_*`

**カスタムラベルの例**:
- `dev/github` → `Label_123`
- `finance/invoice` → `Label_456`
- `project/crm` → `Label_789`

### Step 3: availableLabels準備

Phase 3でLLMに渡すために、各アカウントの利用可能なラベル名一覧を作成：

```javascript
// 擬似コード
const availableLabels = {
  unson: Object.keys(existingLabelIds.unson),  // ["dev/github", "dev/pr", ...]
  salestailor: Object.keys(existingLabelIds.salestailor),
  techknight: Object.keys(existingLabelIds.techknight)
};
```

### Step 4: 結果JSON出力

```bash
Write: /tmp/gmail-auto-labeling/label_validation.json
```

## Output Format

```json
{
  "unson": {
    "existingLabelIds": {
      "finance/invoice": "Label_8764504159471345508",
      "dev/github": "Label_123",
      "dev/pr": "Label_456",
      "spam/promo": "Label_789"
    }
  },
  "salestailor": {
    "existingLabelIds": {
      "project/crm": "Label_890",
      "finance/invoice": "Label_901",
      "dev/vercel": "Label_012"
    }
  },
  "techknight": {
    "existingLabelIds": {
      "dev/github": "Label_345",
      "dev/vercel": "Label_678",
      "business/contract": "Label_234"
    }
  }
}
```

## Success Criteria

- [✅] SC-1: 全アカウントのラベル一覧取得成功
- [✅] SC-2: Label名→ID変換マップ作成完了
- [✅] SC-3: システムラベル除外（カスタムラベルのみ）
- [✅] SC-4: 認証エラーなし（401/403）

## Output to Orchestrator

**成功時**:
```
✅ Phase 1完了
- unson: 15ラベル取得
  - 利用可能ラベル: ["finance/invoice", "dev/github", "dev/pr", ...]
- salestailor: 12ラベル取得
  - 利用可能ラベル: ["project/crm", "finance/invoice", ...]
- techknight: 10ラベル取得
  - 利用可能ラベル: ["dev/github", "dev/vercel", ...]

Output: /tmp/gmail-auto-labeling/label_validation.json
```

**失敗時（認証エラー）**:
```
❌ Phase 1失敗
- Gmail認証エラー（unson: 401 Unauthorized）

→ 人間へエスカレーション（再認証が必要）
```

## Implementation Notes

### システムラベルの除外

Gmail APIの`labels.list`レスポンスには、システムラベルとカスタムラベルが混在：

```json
{
  "labels": [
    { "id": "INBOX", "name": "INBOX", "type": "system" },
    { "id": "Label_123", "name": "dev/github", "type": "user" },
    { "id": "UNREAD", "name": "UNREAD", "type": "system" }
  ]
}
```

**フィルタリング条件**:
- `type === "user"` のみを抽出

### 階層ラベルの扱い

Gmailのラベル階層（例: `dev/github`）は、`name`フィールドに`/`区切りで表現される：

```json
{ "id": "Label_123", "name": "dev/github", "type": "user" }
```

LLMは `dev/github` という名前でラベルを選択する。Phase 3でLabel ID変換時に使用。

### 空ラベルアカウント

初期状態でカスタムラベルが0件のアカウント（techknight等）も正常処理：

```json
{
  "techknight": {
    "existingLabelIds": {}
  }
}
```

LLMは空配列 `[]` の`availableLabels`を受け取り、ラベル付与しない判断をする。

### エラーハンドリング

- **Gmail認証エラー（401/403）**: Phase 1失敗 → 人間へエスカレーション
- **API Rate Limit（429）**: retryWithBackoff（Gmail MCP側で実装済み）
- **ネットワークエラー**: Max 3回リトライ → 失敗時はPhase 1再実行

## Example Execution

### Input

```
accountIds: ["unson", "salestailor", "techknight"]
```

### Process Log

```
[Phase 1] Starting Label Validation...
[Phase 1] Fetching labels for unson...
[Phase 1]   Found 20 labels (15 custom, 5 system)
[Phase 1]   Custom labels: finance/invoice, dev/github, dev/pr, spam/promo, ...
[Phase 1]   Creating Label ID map...
[Phase 1]   ✅ unson complete

[Phase 1] Fetching labels for salestailor...
[Phase 1]   Found 18 labels (12 custom, 6 system)
[Phase 1]   Custom labels: project/crm, finance/invoice, dev/vercel, ...
[Phase 1]   Creating Label ID map...
[Phase 1]   ✅ salestailor complete

[Phase 1] Fetching labels for techknight...
[Phase 1]   Found 15 labels (10 custom, 5 system)
[Phase 1]   Custom labels: dev/github, dev/vercel, business/contract, ...
[Phase 1]   Creating Label ID map...
[Phase 1]   ✅ techknight complete

[Phase 1] Writing results to /tmp/gmail-auto-labeling/label_validation.json
[Phase 1] ✅ Complete (37 custom labels total)
```

### Output

**label_validation.json**:
```json
{
  "unson": {
    "existingLabelIds": {
      "finance/invoice": "Label_8764504159471345508",
      "dev/github": "Label_123",
      "dev/pr": "Label_456",
      "spam/promo": "Label_789",
      "business/contract": "Label_890"
    }
  },
  "salestailor": {
    "existingLabelIds": {
      "project/crm": "Label_901",
      "finance/invoice": "Label_012",
      "dev/vercel": "Label_345"
    }
  },
  "techknight": {
    "existingLabelIds": {
      "dev/github": "Label_678",
      "dev/vercel": "Label_234",
      "business/contract": "Label_567"
    }
  }
}
```

## Performance Considerations

### Gmail API呼び出し回数
- 3回（`labels.list` × 3アカウント）
- 合計: <1秒

### Label ID変換マップ
- O(n) where n=カスタムラベル数/アカウント
- 通常: 10-20ラベル/アカウント → <1秒

## Migration from YAML Rules

### 削除されたStep
- ❌ Step 1: email-classifierルール読み込み
- ❌ Step 3: 不足ラベル検出

### 追加されたStep
- ✅ Step 2: Label名→ID変換マップ作成
- ✅ Step 3: availableLabels準備

### Output変更
- ❌ `missingLabels`: 削除（LLM版では不要）
- ✅ `existingLabelIds`: Label名→IDマップ（Phase 3で使用）
