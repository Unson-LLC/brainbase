---
name: sales-ops
description: セールスチーム（職能ベース）。Sales Rep・Account Manager・Sales Ops Coordinatorの3職能が協働し、リード獲得・顧客管理・セールス最適化を自動化
teammates:
  - name: sales-rep
    agentType: sales-rep
    description: リード獲得・提案書作成・商談実行。BtoBリード獲得施策の実行からセールスコピー作成、商談スクリプト準備までを担当する最前線のセールス職能
    tools: Skill, Bash, Read, Write, WebSearch, WebFetch
  - name: account-manager
    agentType: account-manager
    description: 顧客関係管理・アップセル/クロスセル・継続フォロー。既存顧客の満足度向上とLTV最大化を担当。受託事業の仕組み化知見を活用し、スコープ管理・期待値調整・リピート・横展開を推進
    tools: Skill, Read, Write, Bash, WebSearch
  - name: sales-ops-coordinator
    agentType: sales-ops-coordinator
    description: パイプライン管理・KPI分析・セールス戦略最適化。セールスチーム全体の生産性とパフォーマンスをデータドリブンで管理・改善する職能
    tools: Skill, Bash, Read, Write, Grep, Glob
---

# Sales Ops Skill

**概要**: セールス業務を3職能（Sales Rep / Account Manager / Sales Ops Coordinator）で自動化。marketing-opsパターンを踏襲した職能ベース設計。

**設計思想**: 1 job function = multiple workflows
- Sales Rep（フロントライン）: リード獲得・提案書作成・商談実行（5つのworkflow）
- Account Manager（リレーション）: 顧客フォロー・アップセル・健康度モニタリング（5つのworkflow）
- Sales Ops Coordinator（バックオフィス）: パイプライン管理・KPI分析・戦略最適化（5つのworkflow）

**セールスサイクル統合**:
- 獲得フェーズ: Sales Repが責任（リード→商談→成約）
- 育成フェーズ: Account Managerが責任（リテンション→LTV最大化）
- 管理フェーズ: Sales Ops Coordinatorが責任（データドリブン最適化）

---

## Workflow Overview

```
Phase 1: Team作成
  └── TeamCreate("sales-ops")

Phase 2: Teammates並列起動（blocking）
  ├── sales-rep: リード獲得・提案書作成・商談実行
  ├── account-manager: 顧客フォロー・アップセル・健康度モニタリング
  └── sales-ops-coordinator: パイプライン管理・KPI分析・戦略最適化

Phase 3: 結果統合 & セールスサマリー生成
  └── 各teammateの成果物（JSON）を読み込み
      └── `/tmp/sales-ops/sales_summary.md` に統合レポート出力

Phase 4: Review & Replan（Max 3 Retries）
  └── エラー発生時、該当teammateを再起動

Phase 5: Team cleanup
  └── TeamDelete("sales-ops")
```

**職能間のデータ共有**: `/tmp/sales-ops/` 配下のJSONファイル + SendMessage

---

## Phase 1: Team作成

### Step 1: Teamディレクトリ準備

```bash
mkdir -p /tmp/sales-ops
```

### Step 2: Team作成

```javascript
TeamCreate({
  team_name: "sales-ops",
  description: "セールスチーム: Sales Rep / Account Manager / Sales Ops Coordinator",
  agent_type: "sales-ops-lead"
})
```

---

## Phase 2: Teammates並列起動（blocking）

### Step 1: 3職能を並列起動

**重要**: `run_in_background: false` でblocking実行（全teammateの完了を待つ）

#### Sales Rep起動

```javascript
Task({
  subagent_type: "general-purpose",
  team_name: "sales-ops",
  name: "sales-rep",
  description: "リード獲得・提案書作成・商談実行",
  prompt: "agents/sales_rep.md の内容を参照してください"
})
```

#### Account Manager起動

```javascript
Task({
  subagent_type: "general-purpose",
  team_name: "sales-ops",
  name: "account-manager",
  description: "顧客フォロー・アップセル・健康度モニタリング",
  prompt: "agents/account_manager.md の内容を参照してください"
})
```

#### Sales Ops Coordinator起動

```javascript
Task({
  subagent_type: "general-purpose",
  team_name: "sales-ops",
  name: "sales-ops-coordinator",
  description: "パイプライン管理・KPI分析・戦略最適化",
  prompt: "agents/sales_ops_coordinator.md の内容を参照してください"
})
```

---

## Phase 3: 結果統合 & セールスサマリー生成

### Step 1: 各teammateの成果物を読み込み

```javascript
const salesRepResult = Read({ file_path: "/tmp/sales-ops/sales_rep.json" })
const accountManagerResult = Read({ file_path: "/tmp/sales-ops/account_manager.json" })
const salesOpsCoordinatorResult = Read({ file_path: "/tmp/sales-ops/sales_ops_coordinator.json" })
```

### Step 2: セールスサマリー生成

```markdown
# Sales Ops Summary
生成日時: {timestamp}

## Sales Rep
- 実行ワークフロー: {workflows_executed}
- リード獲得数: {lead_count}
- 提案書作成数: {proposal_count}
- 商談数: {meeting_count}
- ステータス: {status}
- エラー: {errors}

## Account Manager
- 実行ワークフロー: {workflows_executed}
- フォローアップ顧客数: {followup_count}
- アップセル提案数: {upsell_count}
- 健康度スコア平均: {health_score_avg}
- ステータス: {status}
- エラー: {errors}

## Sales Ops Coordinator
- 実行ワークフロー: {workflows_executed}
- パイプライン分析: {pipeline_analysis}
- KPI更新: {kpi_updated}
- 戦略レビュー: {strategy_review}
- ステータス: {status}
- エラー: {errors}

## 全体統計
- リード→商談転換率: {lead_to_meeting_rate}
- 成約率: {close_rate}
- 平均商談期間: {avg_sales_cycle}
- 顧客リテンション率: {retention_rate}
- LTV: {ltv}
```

### Step 3: サマリー保存

```javascript
Write({
  file_path: "/tmp/sales-ops/sales_summary.md",
  content: summary
})
```

---

## Phase 4: Review & Replan（Max 3 Retries）

### Step 1: エラーチェック

```javascript
const hasErrors =
  salesRepResult.errors?.length > 0 ||
  accountManagerResult.errors?.length > 0 ||
  salesOpsCoordinatorResult.errors?.length > 0
```

### Step 2: エラー時の再起動

```javascript
if (hasErrors && retryCount < 3) {
  // エラーが発生したteammateのみ再起動
  if (salesRepResult.errors?.length > 0) {
    // sales-rep 再起動
    Task({ ... })
  }

  if (accountManagerResult.errors?.length > 0) {
    // account-manager 再起動
    Task({ ... })
  }

  if (salesOpsCoordinatorResult.errors?.length > 0) {
    // sales-ops-coordinator 再起動
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

## RACI Structure

| 職能 | Responsible | Accountable | Consulted | Informed |
|------|-------------|-------------|-----------|----------|
| **Sales Rep** | リード獲得・提案書作成・商談実行 | リード→商談転換率・提案品質・初回成約率 | Account Manager（リファラル） | Sales Ops Coordinator |
| **Account Manager** | 顧客フォロー・アップセル・健康度モニタリング | リテンション率・LTV最大化・顧客満足度 | Sales Rep（引き継ぎ） | Sales Ops Coordinator |
| **Sales Ops Coordinator** | パイプライン管理・KPI分析・戦略最適化 | チーム全体パフォーマンス・データドリブン推進 | Sales Rep + Account Manager | - |

---

## Skills Mapping

| 職能 | Primary Skill | Skills |
|------|--------------|--------|
| **Sales Rep** | sales-playbook | sales-playbook, b2b-marketing-60-tactics-playbook, customer-centric-marketing-n1, kernel-prompt-engineering |
| **Account Manager** | jutaku-1oku-shikumi | jutaku-1oku-shikumi, sales-playbook, customer-centric-marketing-n1, planning-okr, task-format |
| **Sales Ops Coordinator** | marketing-strategy-planner | marketing-strategy-planner, kpi-calculation, all-for-saas-playbook, saas-ai-roadmap-playbook, nocodb-4table-guide |

**共有Skills**:
- `sales-playbook`: Sales Rep（セールスコピー/商談）+ Account Manager（アップセル提案）
- `customer-centric-marketing-n1`: Sales Rep（見込み顧客N=1分析）+ Account Manager（健康度モニタリング）

**Skills Coverage**: biz_dev_sales カテゴリ 7/7 (100%)

---

## Notes

- **marketing-opsパターン踏襲**: 3職能並列起動、JSON成果物、team lead統合
- **セールスサイクル3フェーズ**: 獲得（Sales Rep）→ 育成（Account Manager）→ 管理（Sales Ops Coordinator）
- **sales-playbook統合思考**: WHO→WHAT→HOW→心理トリガー→検証が全職能の基盤
- **jutaku-1oku-shikumi**: 受託仕組み化知見をAccount Managerに装備（SaaS+受託ハイブリッド対応）
- **データドリブン**: Sales Ops CoordinatorがKPI計測・パイプライン分析で全体最適化

---

最終更新: 2026-02-08
