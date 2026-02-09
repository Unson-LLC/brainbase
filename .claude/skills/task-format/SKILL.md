---
name: task-format
description: brainbaseにおけるタスク管理ファイル（_tasks/index.md）の標準フォーマット。YAML front matter形式でタスクを記述し、RACI・期限・タグを含む。新規タスクを追加する際に使用。
---

## Triggers

以下の状況で使用：
- 新規タスクを_tasks/index.mdに追加するとき
- タスクのフォーマットを確認したいとき
- タスク一本化率を向上させたいとき

# _tasks/index.md フォーマット仕様

brainbaseにおけるタスク管理ファイル（`_tasks/index.md`）の標準フォーマットです。

## Instructions

### 1. 基本フォーマット

各タスクは**YAML front matter**形式で記述：

```yaml
---
id: PROJECT-WEEK
title: タスクタイトル
project_id: project_name
status: todo | in_progress | done
owner: 担当者名
priority: high | medium | low
due: YYYY-MM-DD
tags: [tag1, tag2, tag3]
raci:
  responsible: 実行者
  accountable: 決裁者
  consulted: [相談先1, 相談先2]
  informed: [報告先1, 報告先2]
links:
  - リンク1
  - リンク2
---

- YYYY-MM-DD イベント: 説明
```

### 2. 必須項目

**id** (必須): `PROJECT-WEEK` または `PROJECT-YYYYMMDD`
- 良い例: `SALESTAILOR-W3`, `BRAINBASE-W5`, `ZEIMS-20241125`
- 悪い例: `task1`, `salestailor-w3`, `TASK-123`

**title** (必須): 動詞から始める、30文字以内
- 良い例: `02_offer/pricing.md を作成`
- 悪い例: `タスク`, `やる`

**project_id** (必須): `config.yml` に登録されているプロジェクトIDのみ

**status** (必須): `todo` | `in_progress` | `done`

**owner** (必須): 担当者名（半角英数字）

**priority** (必須): `high` | `medium` | `low`

**due** (任意だが推奨): `YYYY-MM-DD` または `null`

**raci** (推奨): RACI定義（raci-format スキル参照）

### 3. イベントログ

タスクの経過を時系列で記録：

| イベント種別 | 説明 |
|-----------|------|
| 作成 | タスク作成 |
| 開始 | 作業開始 |
| 相談 | 事前相談 |
| レビュー | レビュー依頼 |
| 承認 | 決裁・承認 |
| 完了 | タスク完了 |
| ブロック | ブロック発生 |

### 4. 保存場所

```
_tasks/index.md
```

**重要**: すべてのタスクを `_tasks/index.md` に一元化。プロジェクト個別のタスクファイル（`TODO.md` など）は非推奨。

### 5. タスク一本化率KPI

```
タスク一本化率 = (_tasks/index.md のタスク数) / (全タスク数) × 100%
```

**目標**: 90%以上

## Examples

### 例1: ドキュメント作成タスク

```yaml
---
id: SALESTAILOR-W3
title: 02_offer/pricing.md を作成
project_id: salestailor
status: todo
owner: keigo
priority: high
due: 2025-12-01
tags: [salestailor, pricing, documentation]
raci:
  responsible: keigo
  accountable: keigo
  consulted: [team, finance]
  informed: [stakeholders]
links:
  - _codex/projects/salestailor/02_offer/pricing.md
---

- 2025-11-25 作成: 価格表とパッケージを明確化
- 2025-11-26 相談: team, finance に価格案を確認
- 2025-11-27 承認: keigo が最終決定
```

### 例2: KPI設定タスク

```yaml
---
id: BRAINBASE-W4
title: KPIダッシュボードをLooker Studioで構築
project_id: brainbase
status: in_progress
owner: keigo
priority: high
due: 2025-12-05
tags: [brainbase, kpi, dashboard]
raci:
  responsible: keigo
  accountable: keigo
  consulted: [team_leads]
  informed: [all_staff]
links:
  - https://lookerstudio.google.com/xxx
---

- 2025-11-25 作成: ダッシュボード設計開始
- 2025-11-26 実装: Looker Studio でグラフ作成
- 2025-11-27 レビュー: team_leads にフィードバック依頼
```

### よくある失敗パターン

**❌ 失敗例1: YAML構文エラー**
```yaml
tags:
- tag1  # ❌ インデント不足
```
→ **修正**:
```yaml
tags:
  - tag1  # ✅
```

**❌ 失敗例2: プロジェクト個別ファイルに記録**
```bash
echo "- [ ] 新規タスク" >> salestailor/TODO.md  # ❌
```
→ **修正**: `_tasks/index.md` に一元化

**❌ 失敗例3: RACIが未定義**
```yaml
# raci: が欠落 ❌
```
→ **修正**: RACIを追加

---

このフォーマットに従うことで、brainbaseの「タスク一本化率90%以上」の目標を達成できます。
