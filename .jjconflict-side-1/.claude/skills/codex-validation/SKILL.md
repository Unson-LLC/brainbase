---
name: codex-validation
description: brainbaseにおける_codex正本とプロジェクト側参照の整合性を検証するロジック。リンク切れ、誤編集、必須項目の検証を実施。_codexの整合性をチェックする際に使用。
---

## Triggers

以下の状況で使用：
- _codex正本とプロジェクト側参照の整合性を確認したいとき
- リンク切れや誤編集を検出したいとき
- 01-05充足率をチェックしたいとき

# _codex 正本検証ロジック

brainbaseにおける _codex 正本とプロジェクト側参照の整合性を検証するロジックです。

## Instructions

### 1. 検証の目的

brainbaseの4大原則の1つ「情報の一本化」を守る：
- **正本**: `_codex/` 配下のファイルのみを編集
- **参照**: プロジェクト側（`<project>/docs/ops/`）はリンクのみ配置

### 2. 検証項目

**2.1 リンク切れ検出**

プロジェクト側のファイルが _codex の正本を正しく参照しているかチェック：

```bash
# プロジェクト側ファイルが _codex へのリンクを含むかチェック
PROJECT_FILE="salestailor/docs/ops/01_strategy.md"

if ! grep -q "_codex/projects/" "$PROJECT_FILE"; then
  echo "❌ リンク切れ: $PROJECT_FILE が _codex を参照していません"
fi

# 参照先が実際に存在するか
LINKED_PATH=$(grep -o "_codex/projects/[^)]*" "$PROJECT_FILE" | head -1)
if [[ ! -f "$LINKED_PATH" ]]; then
  echo "❌ リンク先が存在しません: $LINKED_PATH"
fi
```

**2.2 誤編集検出**

プロジェクト側が実コンテンツを持っていないかチェック：

```bash
# プロジェクト側ファイルの行数をチェック（リンクのみなら10行以内）
LINE_COUNT=$(wc -l < "$PROJECT_FILE")
if [[ $LINE_COUNT -gt 10 ]]; then
  echo "⚠️  誤編集の可能性: $PROJECT_FILE（行数: $LINE_COUNT）"
fi

# 実コンテンツの兆候をチェック
if grep -q "^## " "$PROJECT_FILE"; then
  echo "❌ 誤編集: $PROJECT_FILE に見出し（##）が含まれています"
fi
```

**2.3 正本の必須項目チェック**

01_strategy.md の必須項目：

```bash
REQUIRED_SECTIONS=(
  "プロダクト概要（1文）"
  "ICP（1文）"
  "約束する価値（1文）"
  "価格・前受け"
  "TTFV目標"
  "主要KPI案"
  "次のアクション"
)

for section in "${REQUIRED_SECTIONS[@]}"; do
  if ! grep -q "### $section" "$CODEX_FILE"; then
    echo "❌ 必須項目が欠落: $section"
  fi
done
```

**2.4 01-05 充足率チェック**

全プロジェクトで01〜05が揃っているかチェック：

```bash
PROJECTS=$(yq eval '.projects[].id' config.yml)

for project in $PROJECTS; do
  for i in {1..5}; do
    file="_codex/projects/$project/0${i}_*.md"
    if ! ls $file 1>/dev/null 2>&1; then
      echo "  ❌ 欠落: 0${i}_*.md"
    fi
  done
done
```

### 3. 検証結果のフォーマット

```
📊 _codex 正本検証レポート
━━━━━━━━━━━━━━━━━━━━━━━━━━━

## サマリ
✅ OK: 15項目
⚠️  警告: 3項目
❌ エラー: 1項目

## 詳細

### SalesTailor
✅ 01_strategy.md: リンク正常
✅ 02_offer/: リンク正常
❌ 03_sales_ops/: 欠落
⚠️  04_delivery/: 誤編集の可能性（行数: 25）
✅ 05_kpi/: リンク正常

## 推奨アクション
1. SalesTailor の 03_sales_ops/ を作成
2. SalesTailor の 04_delivery/ の誤編集を修正
```

## Examples

### 例1: リンク切れエラー

**症状**:
```markdown
<!-- salestailor/docs/ops/01_strategy.md -->
正本: [_codex/projects/salestailor/01_strategy.md](../../../_codex/projects/salestailor/01_strategy.md)
```
→ しかし `_codex/projects/salestailor/01_strategy.md` が存在しない

**修正**:
```bash
# 正本を作成
mkdir -p _codex/projects/salestailor
# strategy-template スキルを使って作成
```

### 例2: 誤編集エラー

**症状**:
```markdown
<!-- salestailor/docs/ops/01_strategy.md -->
## SalesTailor 01_strategy｜戦略骨子  ← ❌ 実コンテンツ

### プロダクト概要（1文）
...
```

**修正**:
```bash
# 実コンテンツを _codex に移動
mv salestailor/docs/ops/01_strategy.md _codex/projects/salestailor/01_strategy.md

# プロジェクト側にリンクのみ配置
echo "# 01_strategy

正本: [_codex/projects/salestailor/01_strategy.md](../../../_codex/projects/salestailor/01_strategy.md)" \
> salestailor/docs/ops/01_strategy.md
```

---

この検証ロジックを使うことで、brainbaseの「情報の一本化」原則が守られているかを自動的にチェックできます。
