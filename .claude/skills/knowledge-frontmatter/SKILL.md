---
name: knowledge-frontmatter
description: brainbaseにおけるKnowledge Skills（_codex/knowledge/*.md）のYAMLフロントマター標準仕様。必須8項目（skill_id, title, source_type, primary_use, triggers, inputs, outputs, granularity）と二段階ロード方式を定義。新規Knowledge Skillを作成する際に使用。
---

# Knowledge Skills フロントマター仕様

brainbaseにおけるKnowledge Skills（`_codex/knowledge/*.md`）のフロントマター標準仕様です。

## Instructions

### 1. 標準フォーマット

マークダウンファイルの先頭に配置するYAML形式のメタデータ：

```yaml
---
skill_id: "skill_name_YYYY_MM_DD"
title: "スキル名（日本語OK）"
source_type: "knowledge"
primary_use: "このスキルの主な用途を1文で説明"
triggers:
  - "検索キーワード1"
  - "検索キーワード2"
  - "検索キーワード3"
inputs:
  - "必要な入力情報1"
  - "必要な入力情報2"
outputs:
  - "生成される出力1"
  - "生成される出力2"
granularity: "task"
---

# <スキル名>

スキルの本文をここに記載...
```

### 2. 必須項目の詳細

**skill_id**（必須）:
- 形式: `[a-z_]+_YYYY_MM_DD`
- 命名規則: 英小文字とアンダースコアのみ、日付をサフィックスに
- 一意性: 重複不可

**title**（必須）:
- 形式: 任意の文字列（日本語OK）
- 推奨: 30文字以内、わかりやすい名前

**source_type**（必須）:
- 選択肢: `"knowledge"` | `"decision"` | `"template"`

**primary_use**（必須）:
- 形式: 1文で用途を説明
- 推奨: 30〜80文字、具体的に

**triggers**（必須）:
- 形式: 配列（3〜5個推奨）
- 目的: Claudeがユーザー入力とマッチングするためのキーワード
- 日本語・英語両方含める

**inputs**（必須）:
- 形式: 配列（1〜3個推奨）
- このスキルを使うために必要な入力情報

**outputs**（必須）:
- 形式: 配列（1〜3個推奨）
- このスキルを使った結果、何が生成されるか

**granularity**（必須）:
- 選択肢: `"task"` | `"workflow"` | `"framework"`

### 3. 検証ルール

必須項目8つすべて存在することを確認：
```bash
# 必須項目チェック
grep -q "^skill_id:" file.md || echo "❌ skill_id が欠落"
grep -q "^title:" file.md || echo "❌ title が欠落"
grep -q "^source_type:" file.md || echo "❌ source_type が欠落"
grep -q "^primary_use:" file.md || echo "❌ primary_use が欠落"
grep -q "^triggers:" file.md || echo "❌ triggers が欠落"
grep -q "^inputs:" file.md || echo "❌ inputs が欠落"
grep -q "^outputs:" file.md || echo "❌ outputs が欠落"
grep -q "^granularity:" file.md || echo "❌ granularity が欠落"
```

### 4. 二段階ロード方式

**フェーズ1: 索引構築**（対話開始時）
- _codex/knowledge/*.md のフロントマターのみを読み込み
- skill_id, title, triggers の索引を作成

**フェーズ2: 本文参照**（マッチング時）
- ユーザー入力が triggers に合致したら、該当スキル本文を追加読み込み

## Examples

### 例1: マーケティングフレームワーク

```yaml
---
skill_id: "ai_driven_marketing_2024_11_24"
title: "AI活用マーケティング戦略"
source_type: "knowledge"
primary_use: "AI活用マーケティング戦略を立案する際のフレームワークと実践手順を提供"
triggers:
  - "marketing"
  - "マーケティング"
  - "genai"
  - "ai活用"
  - "戦略立案"
inputs:
  - "対象顧客セグメント"
  - "製品・サービス概要"
  - "競合情報"
outputs:
  - "AI活用マーケティング戦略書"
  - "施策ロードマップ"
  - "KPI定義"
granularity: "framework"
---

# AI活用マーケティング戦略

本スキルは、GenAI時代のマーケティング戦略立案フレームワークです...
```

### 例2: テンプレート

```yaml
---
skill_id: "strategy_template_2024_11_25"
title: "01_strategy.md テンプレート"
source_type: "template"
primary_use: "新規プロジェクトの戦略骨子（01_strategy.md）を作成する際の標準テンプレート"
triggers:
  - "strategy"
  - "戦略"
  - "01_strategy"
  - "プロダクト概要"
  - "ICP"
inputs:
  - "プロジェクト名"
  - "プロダクト概要"
  - "ICP"
outputs:
  - "01_strategy.md"
granularity: "task"
---

# 01_strategy.md テンプレート

新規プロジェクトの戦略骨子を作成するためのテンプレートです...
```

### よくある失敗パターン

**❌ 失敗例1: skill_id の形式ミス**
```yaml
skill_id: "Marketing-2024"  # ❌ ハイフン・大文字
```
→ **修正**:
```yaml
skill_id: "marketing_2024_11_25"  # ✅
```

**❌ 失敗例2: triggers が少なすぎる**
```yaml
triggers:
  - "marketing"  # ❌ 1つだけ
```
→ **修正**:
```yaml
triggers:
  - "marketing"
  - "マーケティング"
  - "戦略"
  - "ai活用"
```

**❌ 失敗例3: フロントマターの囲みミス**
```markdown
---  # ← OK
skill_id: "test"
title: "テスト"
---  # ← 閉じ忘れ ❌

# スキル本文
```
→ **修正**: 必ず `---` で囲む

---

このフロントマター仕様に従うことで、brainbaseの「Knowledge Skills 二段階ロード」が正しく機能します。
