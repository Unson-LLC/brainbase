---
name: ops-daily
description: 毎日の運用タスクを自動化する職能ベースOrchestrator。Executive Assistant・Infrastructure Manager・Knowledge Analystの3職能が複数ワークフローを担当し、組織の朝礼を体現。
tools: []
skills: [email-classifier, learning-extraction, kpi-calculation, task-format]
teammates:
  - name: executive-assistant
    agentType: executive-assistant
    description: 情報収集・優先順位付け・日程管理を担当。朝のブリーフィング、メール仕分け、緊急メール抽出、日程調整、タスク優先順位付けの5ワークフロー実行。
    tools: [ToolSearch, Bash, Read, Write, Skill]
  - name: infrastructure-manager
    agentType: infrastructure-manager
    description: リポジトリ・システム・バックアップ監視を担当。リポジトリ同期、システムヘルスチェック、バックアップ確認、Secrets検出の4ワークフロー実行。
    tools: [Bash, Read, Grep]
  - name: knowledge-analyst
    agentType: knowledge-analyst
    description: 学習抽出・KPI・バズ分析を担当。学習抽出、学習レビュー、KPI計算、SNSバズ分析、週次レポートの5ワークフロー実行。
    tools: [Skill, Read, Write]
---

# ops-daily Orchestrator

毎日の運用タスクを自動化する **職能ベース** Orchestrator。

**設計思想**: 1 job function = multiple workflows
- Executive Assistant（秘書）: 情報収集・優先順位付け・日程管理（5つのworkflow）
- Infrastructure Manager（インフラ管理者）: リポジトリ・システム・バックアップ監視（4つのworkflow）
- Knowledge Analyst（知識分析者）: 学習抽出・KPI・バズ分析（5つのworkflow）

## Orchestration Overview

```
Main Orchestrator
  ├── Phase 1: Executive Assistant起動（5 workflows）
  │   ├── W1: 朝のブリーフィング（カレンダー+タスク+メール状況）
  │   ├── W2: メール仕分け（3アカウント自動振り分け）
  │   ├── W3: 緊急メール抽出（緊急度3以上）
  │   ├── W4: 日程調整（空き時間ベース予定提案）
  │   └── W5: タスク優先順位付け（今日の最優先事項）
  │
  ├── Phase 2: Infrastructure Manager起動（4 workflows）
  │   ├── W1: リポジトリ同期（dirty検出）
  │   ├── W2: システムヘルスチェック（brainbase/launchd/MCP）
  │   ├── W3: バックアップ確認（NocoDB/_codex/config）
  │   └── W4: Secrets検出（.env/API_KEY流出リスク）
  │
  ├── Phase 3: Knowledge Analyst起動（5 workflows）
  │   ├── W1: 学習抽出（昨日のセッションから）
  │   ├── W2: 学習レビュー（learning_queue優先度付け）
  │   ├── W3: KPI計算（6指標算出）
  │   ├── W4: SNSバズ分析（X/note投稿パフォーマンス）
  │   └── W5: 週次レポート（学習・KPI・バズまとめ）
  │
  └── Phase 4: 最終レポート集約
      └── Main Orchestratorが3職能の結果をまとめて報告
```

**職能間のデータ共有**: `/tmp/ops-daily/` 配下のJSONファイル + SendMessage

---

## Phase 1: Executive Assistant

**実行方法**: Main Orchestratorが Task toolで `executive-assistant` Subagentを起動

### Process（Main Orchestrator）

**Step 1: Executive Assistant起動**
```javascript
Task({
  subagent_type: "executive-assistant",
  prompt: "朝のブリーフィング・メール仕分け・緊急メール抽出・日程調整・タスク優先順位付けの5ワークフローを実行してください。成果物は /tmp/ops-daily/ 配下に保存してください。",
  description: "Phase 1 Executive Assistant"
})
```

**Step 2: 完了待機**
- Task toolは自動的に完了を待つ（blocking）

**Step 3: 成果物確認**
```javascript
Read({ file_path: "/tmp/ops-daily/briefing.json" })
Read({ file_path: "/tmp/ops-daily/urgent_emails.json" })
Read({ file_path: "/tmp/ops-daily/priority_tasks.json" })
```

**Step 4: Success Criteriaチェック**
- briefing.json が存在するか
- urgent_emails.json が存在するか
- priority_tasks.json が存在するか

**Step 5: リスク判定**
- **Critical**: いずれかのファイルが存在しない → Phase 1再実行（Max 3回）
- **Minor**: メール仕分け成功率60-80% → 警告記録+Phase 2へ
- **None**: 全ファイル存在 → Phase 2へ

**成果物**:
- `/tmp/ops-daily/briefing.json`: 朝のブリーフィング（カレンダー+タスク+メール状況）
- `/tmp/ops-daily/urgent_emails.json`: 緊急メール（緊急度3以上）
- `/tmp/ops-daily/priority_tasks.json`: 今日の最優先タスク

### Success Criteria
- [✅] SC-1: 朝のブリーフィング生成成功
- [✅] SC-2: メール仕分け成功率 > 80%
- [✅] SC-3: 緊急メール抽出完了
- [✅] SC-4: 日程調整提案成功（空き時間ベース）
- [✅] SC-5: 最優先タスク提案完了

### Review & Replan
- **Critical**: briefing.json生成失敗 → Phase 1再実行
- **Minor**: メール仕分け成功率60-80% → 警告+Phase 2へ
- **None**: 全SC達成 → Phase 2へ

---

## Phase 2: Infrastructure Manager

**実行方法**: Main Orchestratorが Task toolで `infrastructure-manager` Subagentを起動

### Process（Main Orchestrator）

**Step 1: Infrastructure Manager起動**
```javascript
Task({
  subagent_type: "infrastructure-manager",
  prompt: "リポジトリ同期・システムヘルスチェック・バックアップ確認・Secrets検出の4ワークフローを実行してください。成果物は /tmp/ops-daily/ 配下に保存してください。",
  description: "Phase 2 Infrastructure Manager"
})
```

**Step 2: 完了待機**
- Task toolは自動的に完了を待つ（blocking）

**Step 3: 成果物確認**
```javascript
Read({ file_path: "/tmp/ops-daily/repo_status.json" })
Read({ file_path: "/tmp/ops-daily/system_health.json" })
Read({ file_path: "/tmp/ops-daily/backup_status.json" })
Read({ file_path: "/tmp/ops-daily/secrets_status.json" })
```

**Step 4: Success Criteriaチェック**
- repo_status.json が存在するか
- system_health.json が存在するか
- backup_status.json が存在するか（Phase 5実装後）
- secrets_status.json が存在するか（Phase 5実装後）

**Step 5: リスク判定**
- **Critical**: repo_status.json または system_health.json が存在しない → Phase 2再実行（Max 3回）
- **Minor**: dirty/失敗リポジトリあり → 警告記録+Phase 3へ
- **None**: 全ファイル存在 → Phase 3へ

**成果物**:
- `/tmp/ops-daily/repo_status.json`: リポジトリ同期状態（dirty/失敗リスト）
- `/tmp/ops-daily/system_health.json`: システムヘルス（プロセス/launchd/MCP）
- `/tmp/ops-daily/backup_status.json`: バックアップ状態（最終更新日時）※Phase 5実装
- `/tmp/ops-daily/secrets_status.json`: Secrets検出結果※Phase 5実装

### Success Criteria
- [✅] SC-1: リポジトリ同期成功（dirty/失敗リスト取得）
- [✅] SC-2: システムヘルスチェック完了
- [✅] SC-3: バックアップ確認完了（Phase 5実装後）
- [✅] SC-4: Secrets検出完了（Phase 5実装後）

### Review & Replan
- **Critical**: repo_status.json生成失敗 → Phase 2再実行
- **Minor**: dirty/失敗リポジトリあり → 警告+Phase 3へ
- **None**: 全SC達成 → Phase 3へ

---

## Phase 3: Knowledge Analyst

**実行方法**: Main Orchestratorが Task toolで `knowledge-analyst` Subagentを起動

### Process（Main Orchestrator）

**Step 1: Knowledge Analyst起動**
```javascript
Task({
  subagent_type: "knowledge-analyst",
  prompt: "学習抽出・学習レビュー・KPI計算・SNSバズ分析・週次レポートの5ワークフローを実行してください。成果物は /tmp/ops-daily/ 配下に保存してください。",
  description: "Phase 3 Knowledge Analyst"
})
```

**Step 2: 完了待機**
- Task toolは自動的に完了を待つ（blocking）

**Step 3: 成果物確認**
```javascript
Read({ file_path: "/tmp/ops-daily/learning_summary.json" })
Read({ file_path: "/tmp/ops-daily/kpi_report.json" })
Read({ file_path: "/tmp/ops-daily/sns_analysis.json" })
Read({ file_path: "/tmp/ops-daily/weekly_report.md" })
```

**Step 4: Success Criteriaチェック**
- learning_summary.json が存在するか
- kpi_report.json が存在するか（Phase 5実装後）
- sns_analysis.json が存在するか（Phase 5実装後）
- weekly_report.md が存在するか（Phase 5実装後）

**Step 5: リスク判定**
- **Critical**: learning_summary.json が存在しない → Phase 3再実行（Max 3回）
- **Minor**: SNS分析失敗（sns_analysis.json不在） → 警告記録+Phase 4へ
- **None**: 全ファイル存在 → Phase 4へ

**成果物**:
- `/tmp/ops-daily/learning_summary.json`: 学習サマリー（queue状態カウント+Top3）
- `/tmp/ops-daily/kpi_report.json`: KPIレポート（6指標算出）※Phase 5実装
- `/tmp/ops-daily/sns_analysis.json`: SNS分析（Top投稿特定）※Phase 5実装
- `/tmp/ops-daily/weekly_report.md`: 週次レポート（学習・KPI・バズまとめ）※Phase 5実装

### Success Criteria
- [✅] SC-1: 学習抽出成功（queue状態カウント）
- [✅] SC-2: 学習レビュー完了（優先度Top3提案）
- [✅] SC-3: KPI計算完了（6指標算出）※Phase 5実装
- [✅] SC-4: SNSバズ分析完了（Top投稿特定）※Phase 5実装
- [✅] SC-5: 週次レポート生成完了※Phase 5実装

### Review & Replan
- **Critical**: learning_summary.json生成失敗 → Phase 3再実行
- **Minor**: SNS分析失敗 → 警告+Phase 4へ
- **None**: 全SC達成 → Phase 4へ

---

## Phase 4: 最終レポート集約

**実行方法**: Main Orchestratorが直接実行

### Process（Main Orchestrator）

**Step 1: 全成果物読み込み**
```javascript
// Executive Assistant の成果物
const briefing = Read({ file_path: "/tmp/ops-daily/briefing.json" })
const urgentEmails = Read({ file_path: "/tmp/ops-daily/urgent_emails.json" })
const priorityTasks = Read({ file_path: "/tmp/ops-daily/priority_tasks.json" })

// Infrastructure Manager の成果物
const repoStatus = Read({ file_path: "/tmp/ops-daily/repo_status.json" })
const systemHealth = Read({ file_path: "/tmp/ops-daily/system_health.json" })

// Knowledge Analyst の成果物
const learningSummary = Read({ file_path: "/tmp/ops-daily/learning_summary.json" })
```

**Step 2: レポート生成**

Markdown形式で3職能の結果を統合：

```markdown
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 ops-daily レポート | {今日の日付}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## Executive Assistant
✅ 朝のブリーフィング生成完了
  - カレンダー: {briefing.calendar.count}件
  - タスク: {briefing.tasks.count}件
  - 未読メール: {briefing.emails.unread}件

{メール仕分けレポート（/tmp/gmail-auto-labeling/report.md から抽出）}
✅ メール仕分け: {labeled}件成功（{total}件中、成功率{successRate}%）

⚠️ 緊急メール: {urgentEmails.count}件
{urgentEmails.emails を列挙}

✅ 最優先タスク: {priorityTasks.focus}
  理由: {priorityTasks.reasoning}

## Infrastructure Manager
✅ リポジトリ同期: {repoStatus.success}件成功 / {repoStatus.total}件
{repoStatus.dirty > 0 ? "⚠️ dirty: " + repoStatus.dirty_list : "全リポジトリ最新"}

✅ システムヘルス:
  - brainbase: {systemHealth.brainbase_server.running ? "稼働中" : "停止"}
  - launchd: {systemHealth.launchd.status}
  - MCP: {systemHealth.mcp.total}個登録

## Knowledge Analyst
✅ 学習抽出: {learningSummary.extracted}件
  - queue状態: validated={learningSummary.queue_state.validated}, pending={learningSummary.queue_state.pending}
{learningSummary.top3 ? "✅ 学習レビュー: 優先度Top3提案" : ""}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎯 今日のフォーカス提案:
「{priorityTasks.focus}」

理由: {priorityTasks.reasoning}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**Step 3: ユーザーに報告**

生成したMarkdownをユーザーに出力。

### Success Criteria
- [✅] SC-1: 3職能の結果を全て集約
- [✅] SC-2: Markdown形式でレポート生成
- [✅] SC-3: ユーザーに報告完了

### Review & Replan
- **None**: 常に承認 → Orchestrator完了

---

## Orchestrator Responsibilities

### Phase Management
- Phase順序の管理（1 → 2 → 3 → 4）
- Phase間のデータ受け渡し検証
- 各Phaseの完了確認

### Review & Replan
各Phase完了後、以下の4ステップでレビュー：

**Step 1: ファイル存在確認**
- Phase 1: `briefing.json`, `urgent_emails.json`, `priority_tasks.json`
- Phase 2: `repo_status.json`, `system_health.json`, `backup_status.json`
- Phase 3: `learning_summary.json`, `kpi_report.json`, `sns_analysis.json`

**Step 2: Success Criteriaチェック**
- 各PhaseのSCが達成されているか

**Step 3: 差分分析**
- 期待値（Success Criteria）vs 実際（成果物）の差分

**Step 4: リスク判定**
- **Critical**: リプラン必須 → Subagent再実行
- **Minor**: 警告+進行許可 → 次Phaseへ
- **None**: 承認 → 次Phaseへ

**Replan実行フロー**:
1. Issue Detection: 不合格項目の特定
2. Feedback Generation: 修正方針の明示化
3. Subagent Re-execution: Task Tool経由で再起動
4. Re-Review: 同じ基準で再評価
5. Max Retries: 3回（超過時は人間へエスカレーション）

### Error Handling
- **Phase実行失敗**: Max 3回リトライ → 人間へエスカレーション
- **データ不足**: 該当データを"取得失敗"として記録 + 続行
- **API失敗**: MCP失敗時も続行（エラーメッセージ表示）

---

## Usage Example

### Basic Usage
```bash
# カスタムコマンド経由
/ops-daily
```

### Expected Output
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 ops-daily | 金曜日 02/07
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Phase 1: Executive Assistant... ✅ (5 workflows)
Phase 2: Infrastructure Manager... ✅ (4 workflows)
Phase 3: Knowledge Analyst... ✅ (5 workflows)
Phase 4: 最終レポート集約... ✅

（Phase 4の出力参照）
```

---

## File Paths

- **Output Directory**: `/tmp/ops-daily/`
- **Subagents**: `.claude/skills/ops-daily/agents/`

---

## Performance

- **処理時間**: 約10分（3職能並列実行）
- **並列実行**: Phase 1-3で3職能同時起動
- **メール処理**: email-classifier Skillに委譲（約3-5分/300件）

---

## Version

- **Current**: 1.0.0
- **Last Updated**: 2026-02-07
