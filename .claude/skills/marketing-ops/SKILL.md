---
name: marketing-ops
description: マーケティングチーム（職能ベース）。Content Creator・Campaign Manager・Analytics Specialistの3職能が協働し、SNS投稿・スケジュール管理・パフォーマンス分析を自動化
teammates:
  - name: content-creator
    agentType: content-creator
    description: SNS投稿（X/note）の企画・作成・公開
    tools: ToolSearch, Skill, Bash, Read, Write
  - name: campaign-manager
    agentType: campaign-manager
    description: 投稿スケジュール管理・実行・最適化
    tools: Read, Write, Bash, Skill
  - name: analytics-specialist
    agentType: analytics-specialist
    description: パフォーマンス分析・改善提案
    tools: Skill, Bash, Read, Write
---

# Marketing Ops Skill

**概要**: マーケティング業務を3職能（Content Creator / Campaign Manager / Analytics Specialist）で自動化。ops-dailyパターンを踏襲した職能ベース設計。

---

## Workflow Overview

```
Phase 1: Team作成
  └── TeamCreate("marketing-ops")

Phase 2: Teammates並列起動（blocking）
  ├── content-creator: SNS投稿作成（sns-smart等）
  ├── campaign-manager: スケジュール管理・投稿実行
  └── analytics-specialist: パフォーマンス分析・改善提案

Phase 3: 結果統合 & マーケティングサマリー生成
  └── 各teammateの成果物（JSON）を読み込み
      └── `/tmp/marketing-ops/marketing_summary.md` に統合レポート出力

Phase 4: Review & Replan（Max 3 Retries）
  └── エラー発生時、該当teammateを再起動

Phase 5: Team cleanup
  └── TeamDelete("marketing-ops")
```

---

## Phase 1: Team作成

### Step 1: Teamディレクトリ準備

```bash
mkdir -p /tmp/marketing-ops
```

### Step 2: Team作成

```javascript
TeamCreate({
  team_name: "marketing-ops",
  description: "マーケティングチーム: Content Creator / Campaign Manager / Analytics Specialist",
  agent_type: "marketing-ops-lead"
})
```

---

## Phase 2: Teammates並列起動（blocking）

### Step 1: 3職能を並列起動

**重要**: `run_in_background: false` でblocking実行（全teammateの完了を待つ）

#### Content Creator起動

```javascript
Task({
  subagent_type: "general-purpose",
  team_name: "marketing-ops",
  name: "content-creator",
  description: "SNS投稿作成",
  prompt: `
# Content Creator Workflow

あなたは Marketing Ops チームの Content Creator です。

## 役割
SNS投稿（X/note）の企画・作成・公開を担当。

## Workflows（5つ）

### W1: X投稿作成
- トピック: [ユーザー指定またはデフォルト]
- Skill呼び出し: sns-smart
- 成果物: _codex/sns/drafts/{topic}_draft.md

### W2: note記事作成
- Skill呼び出し: note-smart
- 成果物: _codex/sns/drafts/{topic}_note.md

### W3: キュレーション投稿
- Skill呼び出し: x-curate-smart
- 成果物: _codex/sns/drafts/{topic}_curate.md

### W4: 引用リポスト
- Skill呼び出し: x-quote-smart
- 成果物: _codex/sns/drafts/{topic}_quote.md

### W5: リプライ戦略実行
- Skill呼び出し: x-reply-smart
- 成果物: _codex/sns/drafts/{topic}_reply.md

## 実行手順

1. ToolSearch で sns-smart をロード
2. Skill tool で sns-smart 実行
3. 成果物を確認（Read tool）
4. 結果を JSON 形式で保存:

\`\`\`json
{
  "teammate": "content-creator",
  "workflows_executed": ["x_post_creation"],
  "results": {
    "draft_path": "_codex/sns/drafts/topic_draft.md",
    "quality_score": 95,
    "status": "success"
  },
  "errors": []
}
\`\`\`

5. Write tool で /tmp/marketing-ops/content_creator.json に保存
6. SendMessage で team lead に完了報告

## Success Criteria

- [ ] 指定されたSkillが実行されている
- [ ] 成果物が _codex/sns/ に保存されている
- [ ] JSON形式で結果を報告している
- [ ] 品質基準（80点以上等）を満たしている

## Notes

- デフォルトワークフロー: W1 (X投稿作成)
- エラー時は errors 配列に詳細を記録
- 品質スコアが80点未満の場合は再生成を提案
`
})
```

#### Campaign Manager起動

```javascript
Task({
  subagent_type: "general-purpose",
  team_name: "marketing-ops",
  name: "campaign-manager",
  description: "スケジュール管理・投稿実行",
  prompt: `
# Campaign Manager Workflow

あなたは Marketing Ops チームの Campaign Manager です。

## 役割
投稿スケジュール管理・実行・最適化を担当。

## Workflows（4つ）

### W1: 投稿スケジュール確認
- Read: _codex/sns/schedule.md
- 今日の投稿候補を抽出

### W2: 投稿実行
- 承認済みドラフト確認: _codex/sns/drafts/{topic}_reviewed.md
- Bash: python sns_post.py --draft {path}

### W3: 投稿ログ更新
- Read: _codex/sns/post_log.md
- Write: 新規投稿を追記

### W4: カレンダー最適化
- Skill呼び出し: marketing-strategy-planner
- 最適投稿時間を提案

## 実行手順

1. Read tool で _codex/sns/schedule.md を読み込み
2. 今日の日付と一致する投稿候補を抽出
3. 承認済みドラフトがあれば投稿実行
4. post_log.md を更新
5. 結果を JSON 形式で保存:

\`\`\`json
{
  "teammate": "campaign-manager",
  "workflows_executed": ["schedule_check", "post_execution", "log_update"],
  "results": {
    "scheduled_posts": ["topic1", "topic2"],
    "posted": ["topic1"],
    "post_url": "https://x.com/...",
    "log_updated": true,
    "status": "success"
  },
  "errors": []
}
\`\`\`

6. Write tool で /tmp/marketing-ops/campaign_manager.json に保存
7. SendMessage で team lead に完了報告

## Success Criteria

- [ ] 今日の投稿候補が抽出されている
- [ ] 投稿実行が成功している（または手動承認待ち）
- [ ] post_log.md が更新されている
- [ ] JSON形式で結果を報告している

## Notes

- デフォルトワークフロー: W1 (スケジュール確認) + W2 (投稿実行) + W3 (ログ更新)
- 投稿実行前に必ずドラフトが「reviewed」ステータスか確認
- エラー時は手動承認を促す
`
})
```

#### Analytics Specialist起動

```javascript
Task({
  subagent_type: "general-purpose",
  team_name: "marketing-ops",
  name: "analytics-specialist",
  description: "パフォーマンス分析・改善提案",
  prompt: `
# Analytics Specialist Workflow

あなたは Marketing Ops チームの Analytics Specialist です。

## 役割
パフォーマンス分析・改善提案を担当。

## Workflows（5つ）

### W1: X Analytics取得
- Skill呼び出し: x-analytics-source
- 過去7日間のパフォーマンスを取得

### W2: Bookmarks分析
- Skill呼び出し: x-bookmarks-source
- 自分のブックマーク投稿を分析

### W3: パフォーマンスレポート生成
- Read: _codex/sns/post_log.md
- トップ3・ワースト3を抽出
- Write: _codex/sns/analytics/{date}_report.md

### W4: 改善提案
- Skill呼び出し: marketing-failure-patterns
- 失敗パターン診断

### W5: 次週戦略提案
- Skill呼び出し: marketing-strategy-planner
- 次週の投稿戦略を提案

## 実行手順

1. ToolSearch で x-analytics-source をロード
2. Skill tool で x-analytics-source 実行（--days 7）
3. パフォーマンスデータを解析
4. トップ3・ワースト3を抽出
5. 改善提案を生成
6. 結果を JSON 形式で保存:

\`\`\`json
{
  "teammate": "analytics-specialist",
  "workflows_executed": ["x_analytics", "performance_report", "improvement_suggestions"],
  "results": {
    "top_3": [
      {"topic": "brainbase_sales", "impressions": 5000, "engagements": 250},
      ...
    ],
    "worst_3": [...],
    "suggestions": [
      "投稿時間を午前9時に変更",
      "画像を使った投稿を増やす"
    ],
    "report_path": "_codex/sns/analytics/2026-02-07_report.md",
    "status": "success"
  },
  "errors": []
}
\`\`\`

7. Write tool で /tmp/marketing-ops/analytics_specialist.json に保存
8. SendMessage で team lead に完了報告

## Success Criteria

- [ ] X Analytics / Bookmarks 取得成功
- [ ] パフォーマンスレポートが生成されている
- [ ] 改善提案が明記されている
- [ ] JSON形式で結果を報告している

## Notes

- デフォルトワークフロー: W1 (X Analytics) + W3 (レポート生成) + W4 (改善提案)
- エラー時は過去のpost_log.mdから代替分析を実施
- 改善提案は具体的なアクションに落とし込む
`
})
```

---

## Phase 3: 結果統合 & マーケティングサマリー生成

### Step 1: 各teammateの成果物を読み込み

```javascript
const contentCreatorResult = Read({ file_path: "/tmp/marketing-ops/content_creator.json" })
const campaignManagerResult = Read({ file_path: "/tmp/marketing-ops/campaign_manager.json" })
const analyticsSpecialistResult = Read({ file_path: "/tmp/marketing-ops/analytics_specialist.json" })
```

### Step 2: マーケティングサマリー生成

```markdown
# Marketing Ops Summary
生成日時: {timestamp}

## Content Creator
- 実行ワークフロー: {workflows_executed}
- 成果物: {draft_path}
- 品質スコア: {quality_score}
- ステータス: {status}
- エラー: {errors}

## Campaign Manager
- 実行ワークフロー: {workflows_executed}
- 投稿実行: {posted}
- 投稿URL: {post_url}
- ログ更新: {log_updated}
- ステータス: {status}
- エラー: {errors}

## Analytics Specialist
- 実行ワークフロー: {workflows_executed}
- トップ3投稿: {top_3}
- ワースト3投稿: {worst_3}
- 改善提案: {suggestions}
- レポートパス: {report_path}
- ステータス: {status}
- エラー: {errors}

## Next Actions
1. [アクション1]
2. [アクション2]
3. [アクション3]
```

### Step 3: サマリー保存

```javascript
Write({
  file_path: "/tmp/marketing-ops/marketing_summary.md",
  content: summary
})
```

---

## Phase 4: Review & Replan（Max 3 Retries）

### Step 1: エラーチェック

```javascript
const hasErrors =
  contentCreatorResult.errors?.length > 0 ||
  campaignManagerResult.errors?.length > 0 ||
  analyticsSpecialistResult.errors?.length > 0
```

### Step 2: エラー時の再起動

```javascript
if (hasErrors && retryCount < 3) {
  // エラーが発生したteammateのみ再起動
  if (contentCreatorResult.errors?.length > 0) {
    // content-creator 再起動
    Task({ ... })
  }

  if (campaignManagerResult.errors?.length > 0) {
    // campaign-manager 再起動
    Task({ ... })
  }

  if (analyticsSpecialistResult.errors?.length > 0) {
    // analytics-specialist 再起動
    Task({ ... })
  }

  retryCount++
} else if (retryCount >= 3) {
  // 3回失敗したら手動介入を促す
  console.log("⚠️ 3回のリトライに失敗しました。手動確認が必要です。")
}
```

---

## Phase 5: Team cleanup

### Step 1: Team削除

```javascript
TeamDelete()
```

---

## Usage Examples

### 例1: X投稿作成（デフォルト）

```bash
/marketing-ops
```

→ Content Creator が sns-smart を実行し、ドラフトを生成

### 例2: note記事作成

```bash
/marketing-ops --workflow note
```

→ Content Creator が note-smart を実行し、note記事を生成

### 例3: パフォーマンス分析のみ

```bash
/marketing-ops --job-function analytics
```

→ Analytics Specialist のみ起動し、パフォーマンス分析を実行

---

## Notes

- **ops-dailyパターン踏襲**: 職能 = 役割、ワークフロー = 既存Orchestrator呼び出し
- **JSON形式データフロー**: 各teammateは成果物をJSONで保存し、team leadが統合
- **Review & Replan**: エラー時は最大3回まで再実行
- **統合レポート**: マーケティングサマリーで全職能の成果物を一覧化

---

最終更新: 2026-02-07
