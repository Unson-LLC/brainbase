---
name: phase2-focus
description: phase1_results.jsonを読み込み、今日の最優先事項を1つ提案
tools: [Read]
---

# Phase 2: フォーカス提案

## Purpose

タスク・カレンダー・昨日の活動・Slackメンション・メールから、今日の最優先事項を1つ提案する。

## Input

- `/tmp/ohayo/phase1_results.json`（必須）

## Process

### Step 1: phase1_results.json読み込み

```bash
Read: /tmp/ohayo/phase1_results.json
```

以下のデータを取得：
- `calendar`: カレンダーイベント
- `tasks`: 未完了タスク
- `git`: 昨日のコミット
- `slack`: Slack未対応メンション
- `gmail`: Gmail処理結果

### Step 2: 優先度スコアリング

各項目に優先度スコアを割り当て：

**Gmail高緊急度メール**: urgency × 10点
- urgency 4: 40点
- urgency 3: 30点
- urgency 2: 20点

**高優先度タスク**: priority × deadline近接度
- priority: high = 3, medium = 2, low = 1
- deadline近接度:
  - 今日: ×5
  - 明日: ×3
  - 2-3日後: ×2
  - 4日以降: ×1

**Slackメンション**: 1件あたり15点

**カレンダーイベント**: 1件あたり5点（開始時刻が近いほど優先）

**昨日の活動**: 継続作業の場合 +10点

### Step 3: 最優先事項を1つ選定

スコアリング結果の上位1件を選定。

**選定基準**:
1. **緊急度**: 今日中に対応すべきか
2. **重要度**: ビジネスインパクトがあるか
3. **影響範囲**: 他のタスクをブロックしていないか

### Step 4: 提案テキスト生成

```markdown
💡 今日のフォーカス提案:
「{タスク名/メール件名/メンション内容}」

理由: {選定理由（緊急度・重要度・影響範囲を明記）}
```

## Output Format

**Markdownテキスト**:
```markdown
💡 今日のフォーカス提案:
「Fly.io支払い失敗の対応」

理由: 緊急度4の高優先度メールで、サービス停止リスクあり。今日中に対応しないとtechknightのサービスに影響が出る可能性。
```

## Success Criteria

- [✅] SC-1: phase1_results.json 読み込み成功
- [✅] SC-2: 優先度スコアリング実施
- [✅] SC-3: 最優先事項を1つ選定（根拠を明記）

## Error Handling

- **phase1_results.json不在**: エラーを返す（Critical）
- **phase1_results.json読み込み失敗**: エラーを返す（Critical）
- **全データが空**: 「今日は特に優先すべきタスクはありません」を返す

**重要**: phase1_results.jsonが必須。不在の場合はこのPhaseを実行できない。

## Example Outputs

### 例1: 高緊急度メール優先

```markdown
💡 今日のフォーカス提案:
「Fly.io支払い失敗の対応」

理由: 緊急度4の高優先度メールで、サービス停止リスクあり（スコア: 40点）。今日中に対応しないとtechknightのサービスに影響が出る可能性。
```

### 例2: Deadlineの近いタスク優先

```markdown
💡 今日のフォーカス提案:
「ohayo-orchestrator実装完了」

理由: 今日がdeadlineの高優先度タスク（スコア: 15点）。完了しないと明日のリリースがブロックされる。
```

### 例3: Slackメンション優先

```markdown
💡 今日のフォーカス提案:
「田中太郎からのコードレビュー依頼」

理由: Slackメンション（スコア: 15点）。他メンバーの作業をブロックしている可能性があり、早期対応が望ましい。
```

### 例4: タスクが何もない場合

```markdown
💡 今日のフォーカス提案:
「今日は特に優先すべきタスクはありません」

理由: 未完了タスク、高緊急度メール、Slackメンションがすべて0件。今日は自由に使える時間です。
```

## Scoring Logic Details

**スコア計算式**:
```
total_score = (
  gmail_urgency × 10
  + task_priority × deadline_multiplier
  + slack_mention_count × 15
  + calendar_proximity_score × 5
  + git_continuation_bonus
)
```

**deadline_multiplier**:
- 今日: 5
- 明日: 3
- 2-3日後: 2
- 4-7日後: 1
- 8日以降: 0.5

**git_continuation_bonus**:
- 昨日のコミットと関連するタスク: +10点
- 関連性の判定: タスクタイトルとコミットメッセージの類似度
