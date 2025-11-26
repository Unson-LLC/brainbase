---
name: raci-format
description: brainbaseにおけるRACIマトリクス（Responsible/Accountable/Consulted/Informed）の標準フォーマットと運用ルール。役割と責任を明確化し、意思決定を高速化する。RACIを定義する際に使用。
---

# RACI定義フォーマット

brainbaseにおけるRACIマトリクスの標準フォーマットと運用ルールです。

## Instructions

### 1. RACIの基本理解

**RACI** = 責任分担マトリクス（役割と権限の明確化）

- **R (Responsible)**: 実行責任者（実際に作業する人）
- **A (Accountable)**: 説明責任者・最終決裁者（成果に責任を持つ人）
- **C (Consulted)**: 事前相談先（意見を求める人）
- **I (Informed)**: 事後報告先（結果を知らせる人）

**重要な原則**:
1. **Aは1人のみ**: 最終決裁者は必ず1人に絞る
2. **Rは複数可**: 実行者は複数いてもOK（ただし明確に分担）
3. **C/Iは必要最小限**: 相談・報告先が多すぎると意思決定が遅れる

### 2. 標準フォーマット

**_codex/common/meta/raci.md** に全プロジェクトのRACIを一元管理：

```markdown
# RACI定義マトリクス

## プロジェクト: <project-name>

### タスク1: <タスク名>
| 役割 | 担当者 | 備考 |
|------|--------|------|
| **R (Responsible)** | <実行者名> | 実際の作業担当 |
| **A (Accountable)** | <決裁者名> | 最終責任者（必ず1人） |
| **C (Consulted)** | <相談先名> | 事前に意見を求める |
| **I (Informed)** | <報告先名> | 事後に結果を報告 |
```

### 3. _tasks/index.md への組み込み

タスクファイルには、YAML front matterでRACIを埋め込む：

```yaml
---
id: SALESTAILOR-W3
title: 02_offer/pricing.md を作成
project_id: salestailor
status: todo
owner: keigo
priority: high
due: 2025-12-01
tags: [salestailor, pricing]
raci:
  responsible: keigo
  accountable: keigo
  consulted: [team, finance]
  informed: [stakeholders]
---
```

### 4. 典型的なパターン

**パターン1: ドキュメント作成**
```yaml
raci:
  responsible: keigo          # 実際に書く人
  accountable: keigo          # 最終承認者
  consulted: [team]           # レビュー依頼先
  informed: [stakeholders]    # 完成後に共有
```

**パターン2: 価格変更**
```yaml
raci:
  responsible: sales          # 提案書作成
  accountable: ceo            # 最終決裁
  consulted: [finance, legal] # 財務・法務に相談
  informed: [all_staff]       # 全社員に通知
```

**パターン3: KPI設定**
```yaml
raci:
  responsible: analyst        # データ分析担当
  accountable: ceo            # 目標設定の最終責任
  consulted: [team_leads]     # 各チームリーダーに相談
  informed: [all_staff]       # 全社員に共有
```

### 5. RACI運用率KPI

brainbaseでは「RACI運用率」をKPIとして計測：

```
RACI運用率 = (RACI定義済みタスク数) / (全タスク数) × 100%
```

**目標**: 80%以上

## Examples

### 例1: SalesTailor の戦略ドキュメント作成

**_codex/common/meta/raci.md**:
```markdown
## SalesTailor

### 01_strategy.md 作成
| 役割 | 担当者 | 備考 |
|------|--------|------|
| R | keigo | 戦略骨子を執筆 |
| A | keigo | 最終承認 |
| C | team | レビュー・フィードバック |
| I | stakeholders | 完成後に共有 |
```

**_tasks/index.md**:
```yaml
---
id: SALESTAILOR-W1
title: 01_strategy.md 作成
project_id: salestailor
status: done
owner: keigo
priority: high
due: 2025-11-30
tags: [salestailor, strategy, documentation]
raci:
  responsible: keigo
  accountable: keigo
  consulted: [team]
  informed: [stakeholders]
---

- 2025-11-25 作成: 戦略骨子を執筆開始
- 2025-11-26 レビュー: team にフィードバック依頼
- 2025-11-27 承認: keigo が最終決定
- 2025-11-28 共有: stakeholders に共有
- 2025-11-28 完了: 01_strategy.md 公開
```

### 例2: brainbase の価格改定

**_codex/common/meta/raci.md**:
```markdown
## brainbase

### 価格改定
| 役割 | 担当者 | 備考 |
|------|--------|------|
| R | sales | 新価格案を作成 |
| A | ceo | 最終決裁 |
| C | finance, legal | 財務・法務に事前相談 |
| I | all_staff | 全社員に通知 |
```

### よくある失敗パターン

**❌ 失敗例1: Aが複数**
```yaml
raci:
  responsible: keigo
  accountable: [keigo, ceo]  # ❌ 責任が曖昧
```
→ **修正**: Accountableは1人に絞る
```yaml
raci:
  responsible: keigo
  accountable: ceo  # ✅ 最終責任者は1人
  consulted: [keigo]  # keigoは相談先にする
```

**❌ 失敗例2: Rが曖昧**
```yaml
raci:
  responsible: "チーム全員"  # ❌ 誰が実際にやるのか不明
```
→ **修正**: 具体的な担当者を指定
```yaml
raci:
  responsible: keigo  # ✅ 明確
```

**❌ 失敗例3: Cが多すぎる**
```yaml
raci:
  consulted: [team1, team2, team3, finance, legal, hr, ...]  # ❌ 多すぎ
```
→ **修正**: 本当に必要な人だけに絞る
```yaml
raci:
  consulted: [finance, legal]  # ✅ 必要最小限
```

---

このフォーマットに従うことで、brainbaseの「RACI運用率80%以上」の目標を達成できます。
