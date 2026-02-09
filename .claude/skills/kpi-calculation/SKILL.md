---
name: kpi-calculation
description: brainbaseの主要KPI（タスク一本化率、01-05充足率、RACI運用率、ブランドガイド整備率、引き継ぎリードタイム、Knowledge Skills有効率）の計測ロジック。KPIレポートを生成する際に使用。
---

## Triggers

以下の状況で使用：
- KPIレポートを生成するとき
- brainbaseの運用状況を定量的に把握したいとき
- 改善アクションを決定するとき

# brainbase KPI計測ロジック

## 主要KPI一覧

| KPI | 目標 | 計測頻度 |
|-----|------|---------|
| 1. タスク一本化率 | 90%以上 | 週次 |
| 2. 01-05充足率 | 100% | 月次 |
| 3. RACI運用率 | 80%以上 | 週次 |
| 4. ブランドガイド整備率 | 100% | 月次 |
| 5. 引き継ぎリードタイム | 7日以内 | 四半期 |
| 6. Knowledge Skills有効率 | 95%以上 | 週次 |

## 計測方法

### 1. タスク一本化率

```
タスク一本化率 = (_tasks/index.md のタスク数) / (全タスク数) × 100%
```

```bash
TASKS_IN_INDEX=$(grep -c "^---" _tasks/index.md)

INDIVIDUAL_TASKS=0
for project in $(yq eval '.projects[].local.path' config.yml); do
  if [[ -f "$project/TODO.md" ]]; then
    COUNT=$(grep -c "^- \[ \]" "$project/TODO.md" 2>/dev/null || echo 0)
    INDIVIDUAL_TASKS=$((INDIVIDUAL_TASKS + COUNT))
  fi
done

TOTAL_TASKS=$((TASKS_IN_INDEX + INDIVIDUAL_TASKS))
CONSOLIDATION_RATE=$(echo "scale=2; $TASKS_IN_INDEX / $TOTAL_TASKS * 100" | bc)
```

### 2. 01-05充足率

```
01-05充足率 = (01-05が揃っているプロジェクト数) / (全プロジェクト数) × 100%
```

```bash
PROJECTS=$(yq eval '.projects[].id' config.yml)
TOTAL_PROJECTS=$(echo "$PROJECTS" | wc -l)
COMPLETE_PROJECTS=0

for project in $PROJECTS; do
  COMPLETE=true
  for i in {1..5}; do
    if ! ls "_codex/projects/$project/0${i}_*.md" 1>/dev/null 2>&1; then
      COMPLETE=false
      break
    fi
  done
  [[ "$COMPLETE" == "true" ]] && ((COMPLETE_PROJECTS++))
done

COVERAGE=$(echo "scale=2; $COMPLETE_PROJECTS / $TOTAL_PROJECTS * 100" | bc)
```

### 3. RACI運用率

```
RACI運用率 = (RACI定義済みタスク数) / (全タスク数) × 100%
```

```bash
TOTAL_TASKS=$(grep -c "^---" _tasks/index.md)
RACI_DEFINED=$(grep -c "^raci:" _tasks/index.md)
RACI_RATE=$(echo "scale=2; $RACI_DEFINED / $TOTAL_TASKS * 100" | bc)
```

### 4. ブランドガイド整備率

```
ブランドガイド整備率 = (MVV定義済み組織数) / (全組織数) × 100%
```

```bash
ALL_ORGS=("unson" "baao" "salestailor" "techknight" "zeims")
TOTAL_ORGS=${#ALL_ORGS[@]}
MVV_DEFINED=0

for org in "${ALL_ORGS[@]}"; do
  if [[ -f "_codex/orgs/${org}.md" ]]; then
    if grep -q "Mission\|Vision\|Value" "_codex/orgs/${org}.md"; then
      ((MVV_DEFINED++))
    fi
  fi
done

BRAND_RATE=$(echo "scale=2; $MVV_DEFINED / $TOTAL_ORGS * 100" | bc)
```

### 5. 引き継ぎリードタイム

```
引き継ぎリードタイム = 新規メンバーが _codex を理解し、タスクを実行できるまでの日数
```

手動計測（四半期ごと）：
- 記録場所: `_codex/common/meta/onboarding_log.md`
- 計算: 完了日 - 参加日

### 6. Knowledge Skills有効率

```
Knowledge Skills有効率 = (有効なスキル数) / (全スキル数) × 100%
```

```bash
KNOWLEDGE_DIR="_codex/knowledge"
TOTAL_SKILLS=$(find "$KNOWLEDGE_DIR" -name "*.md" | wc -l)
VALID_SKILLS=0

REQUIRED_FIELDS=("skill_id" "title" "source_type" "primary_use" "triggers" "inputs" "outputs" "granularity")

for file in "$KNOWLEDGE_DIR"/*.md; do
  VALID=true
  for field in "${REQUIRED_FIELDS[@]}"; do
    if ! grep -q "^${field}:" "$file"; then
      VALID=false
      break
    fi
  done
  [[ "$VALID" == "true" ]] && ((VALID_SKILLS++))
done

VALID_RATE=$(echo "scale=2; $VALID_SKILLS / $TOTAL_SKILLS * 100" | bc)
```

## レポートフォーマット

```markdown
# brainbase KPI レポート
生成日時: YYYY-MM-DD HH:MM

## 📊 サマリ
| KPI | 実績 | 目標 | 達成率 | 判定 |
|-----|------|------|--------|------|
| タスク一本化率 | X% | 90% | Y% | ✅/⚠️ |
| 01-05充足率 | X% | 100% | Y% | ✅/⚠️ |
| RACI運用率 | X% | 80% | Y% | ✅/⚠️ |
| ブランドガイド整備率 | X% | 100% | Y% | ✅/⚠️ |
| 引き継ぎリードタイム | X日 | 7日 | Y% | ✅/⚠️ |
| Knowledge Skills有効率 | X% | 95% | Y% | ✅/⚠️ |

## 📈 改善アクション
1. 具体的なアクション...
2. ...
```

## 例: 週次レポート

```
📊 brainbase KPI レポート（週次）
生成日時: 2025-11-25 14:30

## 1. タスク一本化率: 85%
  _tasks/index.md: 42 タスク
  プロジェクト個別: 7 タスク
  全タスク: 49 タスク
  目標: 90%以上
  判定: ⚠️ あと5%必要

## 2. RACI運用率: 78%
  RACI定義済み: 33 タスク
  全タスク: 42 タスク
  目標: 80%以上
  判定: ⚠️ あと1タスクにRACIを追加

## 3. Knowledge Skills有効率: 95%
  有効: 19 スキル
  無効: 1 スキル
  全スキル: 20 スキル
  目標: 95%以上
  判定: ✅ 目標達成

## 📈 改善アクション
1. プロジェクト個別タスク7件を _tasks/index.md に移行
2. 未定義タスク9件にRACIを追加
3. marketing_failure_patterns.md の 'triggers' を追加
```

---
最終更新: 2025-12-19
