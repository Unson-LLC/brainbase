---
name: email-classifier
description: LLMでメール内容を分析し、適切なラベル・緊急度・返信必要性を判断。brainbase知識を活用可能。
tools: [Read, Bash]
skills: []
model: claude-sonnet-4-5-20250929
---

# email-classifier (LLM版)

## 概要

YAMLルール廃止。LLMでメール内容を分析し、適切なラベル・緊急度・返信必要性を判断する。

**主な変更点**:
- ❌ YAMLルールベース削除
- ✅ LLM推論で分類
- ✅ brainbase知識活用（RACI、プロジェクト、人物情報）
- ✅ 緊急度判定（1-5段階）
- ✅ 返信必要性判断

## Input

```typescript
{
  message: {
    from: string,           // 送信者メールアドレス
    subject: string,        // 件名
    body: string,           // 本文
    date?: string           // 送信日時（オプション）
  },
  accountId: string,        // "unson" | "salestailor" | "techknight"
  availableLabels: string[], // 使用可能なラベル一覧（Phase 1から渡される）
  brainbaseContext?: {      // オプション（Phase 3で取得）
    accountRaci?: object,   // アカウントのRACI情報
    relatedPerson?: object, // 送信者に関連するPerson entity
    relatedProjects?: object[] // 関連プロジェクト
  }
}
```

## Process

### Step 1: プロンプトテンプレート読み込み

```bash
Read: /Users/ksato/workspace/.claude/skills/email-classifier/prompts/classify.md
```

### Step 2: プロンプト変数置換

テンプレート変数を実際の値に置換：
- `{availableLabels}` → `["dev/github", "dev/pr", ...]`
- `{from}` → 送信者メールアドレス
- `{subject}` → 件名
- `{body}` → 本文（長すぎる場合は先頭2000文字）
- `{accountId}` → アカウントID
- `{brainbaseContext}` → RACI/Person/Project情報（存在する場合）

### Step 3: LLM推論実行

Model: sonnet（複雑な判断が必要）

LLMに以下を依頼：
1. メール内容を分析
2. 適切なラベルを選択（availableLabelsから）
3. 緊急度を判定（1-5）
4. 返信必要性を判断
5. 判断理由を説明

### Step 4: レスポンスパース & バリデーション

- JSON抽出（```json ... ``` ブロック）
- `addLabelNames` のバリデーション
  - availableLabels に存在しないラベルは除外
  - 空配列の場合は警告（ルールマッチなし）
- `urgency` の正規化（1-5の範囲外は丸める）
- `needsReply` のboolean変換

### Step 5: Output形式に変換

LLMレスポンスを標準Output形式に変換：
```javascript
{
  addLabelNames: ["dev/github", "dev/pr"],  // Label名（Label ID変換はPhase 3で実施）
  removeLabelIds: ["INBOX", "UNREAD"],
  urgency: 3,
  needsReply: false,
  reasoning: "GitHub PR通知。開発関連なので dev/github, dev/pr を付与",
  actions: {
    archive: false,
    markAsRead: false
  }
}
```

## Output

```typescript
{
  addLabelNames: string[],    // 追加するラベル名（availableLabelsから選択）
  removeLabelIds: string[],   // 削除するシステムラベルID（INBOX, UNREAD等）
  urgency: number,            // 1-5（1=低, 5=緊急）
  needsReply: boolean,        // 人間の返信が必要か
  reasoning: string,          // LLMの判断理由
  actions: {
    archive: boolean,         // アーカイブするか
    markAsRead: boolean       // 既読にするか
  }
}
```

### Output Schema詳細

**addLabelNames** (string[]):
- availableLabelsから選択されたラベル名
- 複数選択可能（例: ["dev/github", "dev/pr"]）
- 存在しないラベルは自動除外

**removeLabelIds** (string[]):
- 削除するシステムラベルID
- 基本的に["INBOX"]または["INBOX", "UNREAD"]
- 分類したメールは受信トレイから移動

**urgency** (number):
- 1: 通知・情報提供のみ
- 2: 低優先度（週内対応）
- 3: 中優先度（数日以内）
- 4: 高優先度（24時間以内）
- 5: 緊急（即座に対応必要）

**needsReply** (boolean):
- true: 人間の返信が必要（決裁依頼、質問、商談調整等）
- false: 自動通知、情報共有のみ

**reasoning** (string):
- LLMがどのように判断したかの説明
- ラベル選択理由、緊急度判定理由を含む
- デバッグ・改善に活用

**actions**:
- archive: true → INBOX削除 + アーカイブフォルダへ
- markAsRead: true → 既読マーク（低優先度の通知等）

## LLM Prompt Template

プロンプトテンプレートは `/Users/ksato/workspace/.claude/skills/email-classifier/prompts/classify.md` に配置。

テンプレート構造：
```markdown
# Email Classification Task

## Available Labels
{availableLabels}

## Email Details
**From**: {from}
**Subject**: {subject}
**Date**: {date}
**Body**:
{body}

## Context from brainbase
{brainbaseContext}

## Your Task
...

## Output Format (JSON only)
...

## Classification Guidelines
...
```

## Usage Example

### Input

```json
{
  "message": {
    "from": "notifications@github.com",
    "subject": "Pull Request #123 opened",
    "body": "A new PR has been opened by @user...",
    "date": "2026-01-03T10:00:00Z"
  },
  "accountId": "unson",
  "availableLabels": ["dev/github", "dev/pr", "finance/invoice", "spam/promo"],
  "brainbaseContext": {
    "accountRaci": {
      "entity": "UNSON",
      "ceo": "佐藤圭吾"
    }
  }
}
```

### Expected Output

```json
{
  "addLabelNames": ["dev/github", "dev/pr"],
  "removeLabelIds": ["INBOX"],
  "urgency": 2,
  "needsReply": false,
  "reasoning": "GitHub PR通知。自動通知なので緊急度は低い。開発関連のため dev/github と dev/pr を付与。返信不要。",
  "actions": {
    "archive": false,
    "markAsRead": false
  }
}
```

## Error Handling

### プロンプトテンプレート不在
- エラーログ出力
- デフォルト動作: ラベルなし、urgency=3、needsReply=false

### LLMレスポンスがJSON形式でない
- JSON抽出試行（```json ... ``` ブロック）
- 抽出失敗時: エラーログ + デフォルト動作

### availableLabelsに存在しないラベル
- 該当ラベルを自動除外
- 警告ログ出力（"Label not found: xxx"）

### urgency範囲外
- 1未満 → 1
- 5超過 → 5
- 数値以外 → 3（デフォルト）

## Performance Considerations

### LLM呼び出しコスト
- Model: sonnet（~$0.003/メール推定）
- 300件処理: ~$0.90
- 従来のYAMLルール: $0（無料）

**コスト最適化策**:
- 本文を2000文字に制限
- brainbaseContextは必要最小限（送信者関連のみ）
- Batch処理は行わない（1メール = 1推論）

### 処理時間
- LLM推論: ~1-2秒/メール
- 300件処理: ~5-10分
- 従来のYAMLルール: ~数秒

**時間最適化策**:
- 並列処理（Phase 3で検討）
- プロンプト最適化（簡潔に）

## Migration from YAML Rules

### 旧ルールの扱い
- `/Users/ksato/workspace/.claude/skills/email-classifier/rules/` → **削除**
- default_rules.yml → **廃止**

### 移行手順
1. ✅ SKILL.md書き換え（このファイル）
2. ✅ prompts/classify.md作成
3. ✅ rules/削除
4. ✅ Phase 3修正（availableLabels, brainbaseContext渡す）
5. ✅ テスト実行（10件 Dry Run）

## Notes

- **Label ID変換**: addLabelNamesはラベル名を返す。Label ID変換はPhase 3で実施（label_validation.jsonを参照）
- **brainbase連携**: オプション機能。Phase 3でbrainbase MCPを使ってcontext取得
- **返信下書き**: needsReply=trueの場合、別タスクで返信下書き生成（このSkillでは生成しない）
- **学習**: 将来的にユーザーフィードバックで改善可能（現時点では未実装）
