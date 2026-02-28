---
name: phase1_requirements_analysis
description: プロジェクトの既存ワークフロー（タスク、マイルストーン）を調査し、brainbase標準との整合性をチェック
tools:
  - Read        # _codex/projects/{project}/ 配下のファイル読み込み
  - Grep        # タスク・マイルストーン検索
  - Skill       # task-format、milestone-management参照
  - AskUserQuestion  # プロジェクト名確認時
skills: [task-format, milestone-management]
model: claude-sonnet-4-5-20250929
---

# Phase 1: 要件分析

**親Skill**: test-workflow-validator
**Phase**: 1/2
**使用Skills**: task-format, milestone-management

---

## Purpose

プロジェクトの既存ワークフロー（タスク、マイルストーン）を調査し、brainbase標準プロセスとの整合性をチェックします。

**Why this Phase exists**:
- プロジェクトの現状を客観的に把握するため
- brainbase標準（task-format, milestone-management）との乖離を定量化するため
- 次Phase（検証レポート生成）に具体的な課題リストを提供するため

**Key Responsibilities**:
1. プロジェクトのタスク・マイルストーン情報を収集
2. task-format Skillに基づいてタスクフォーマット適合率を算出
3. milestone-management Skillに基づいてマイルストーン粒度を評価
4. 課題リストと整合性チェック結果をmarkdown見出し構造で出力

---

## Context

### Input（前Phaseから受け取るデータ）

**前Phase**: なし（Phase 1が最初のPhase）

**ユーザーからの入力**:
- プロジェクト名（例: `brainbase-ui`, `mana`）
- 検証スコープ（任意、デフォルト: `both`）

### 参照ファイル

**プロジェクト固有**:
- `_codex/projects/{project}/01_strategy.md` - プロジェクト戦略
- `_codex/projects/{project}/02_raci.md` - RACI定義
- `_codex/projects/{project}/03_tasks.md` - タスク一覧
- `_tasks/index.md` - タスク管理ファイル（YAML front matter形式）

**brainbase共通**:
- `.claude/skills/task-format/SKILL.md` - タスク標準フォーマット定義
- `.claude/skills/milestone-management/SKILL.md` - マイルストーン管理ルール定義

---

## Thinking Framework

### task-format Skillの思考フレームワークを活用

task-formatが提供する「標準タスクフォーマット」を使用して、タスクの適合率を算出します：

**フレームワークの概要**:
1. **YAML front matter形式**
   - 必須フィールド: title, status, deadline, assignee
   - 任意フィールド: tags, project, raci

2. **タスク記述形式**
   - 具体的な行動動詞で開始
   - 完了条件が明確

3. **ステータス管理**
   - 標準ステータス: pending, in_progress, completed, archived

**思考パターン**:
```
タスクファイルを発見 → 「YAML front matterが存在するか?」
front matterあり → 「必須フィールドが揃っているか?」
フィールド不足 → 「課題リストに追加」
```

### milestone-management Skillの思考フレームワークを活用

milestone-managementが提供する「マイルストーン粒度管理」を使用して、マイルストーンの適切性を評価します：

**フレームワークの概要**:
1. **適切な粒度**
   - 1マイルストーン = 1〜4週間スパン
   - Success Criteriaが検証可能

2. **依存関係の明示**
   - 前提条件の明記
   - 次マイルストーンとの関係性

3. **進捗可視化**
   - 完了率の測定可能性

**思考パターン**:
```
マイルストーン発見 → 「期間スパンは適切か（1〜4週間）?」
スパン過大 → 「分割可能か?」
Success Criteria不明確 → 「課題リストに追加」
```

---

## Process

### Step 1: プロジェクト情報の収集

**目的**: プロジェクトディレクトリからタスク・マイルストーン情報を収集

**実行内容**:
```bash
# 1. プロジェクトディレクトリの存在確認
Read _codex/projects/{project}/

# 2. タスクファイルの検索
Grep pattern:"^\-\s*\[" path:_tasks/index.md

# 3. マイルストーンファイルの検索
Grep pattern:"^##\s*Milestone" path:_codex/projects/{project}/
```

**抽出する情報**:
- タスク総数
- YAML front matter形式のタスク数
- マイルストーン総数
- 各マイルストーンの期間スパン

**思考パターン適用**:
- task-formatの「YAML front matter形式」を使用 → タスクフォーマット適合率を算出
- milestone-managementの「適切な粒度」を使用 → マイルストーン粒度の評価

---

### Step 2: 整合性チェックの実行

**目的**: brainbase標準との整合性を定量評価

**実行内容**:
1. **タスクフォーマット適合率の算出**:
   - YAML front matter形式のタスク数 / タスク総数
   - 必須フィールド充足率

2. **マイルストーン粒度チェック**:
   - 1〜4週間スパンのマイルストーン数 / マイルストーン総数
   - Success Criteria明示率

3. **課題の特定**:
   - 適合率が80%未満の項目を課題としてリスト化
   - 重大度（Critical/Medium）を判定

**思考パターン適用**:
```
タスク適合率 < 80% → task-format違反 → Critical課題
マイルストーン粒度不適切 → milestone-management違反 → Medium課題
```

---

### Step 3: ユーザーへの確認（不足情報の補完）

**必須項目**:
- プロジェクト名: ディレクトリパスの特定に必要
- 検証スコープ: タスク/マイルストーン/両方

**不足している情報をユーザーに質問**:
- AskUserQuestion toolを使用
- プロジェクト名が未指定の場合のみ質問
- デフォルト値は設定せず、必ず確認を取る

**質問例**:
```
Q1: 検証対象のプロジェクト名を教えてください（例: brainbase-ui, mana）
Q2: 検証スコープを選択してください（タスク / マイルストーン / 両方）
```

---

### Step 4: 課題リストと整合性チェック結果の出力

**ファイル構造**:
```markdown
# Phase 1 実行結果: 要件分析

**作成日**: 2025-12-30
**Phase**: 1/2

## 課題リスト
- 課題1: タスクフォーマット不整合（_tasks/index.md）
- 課題2: マイルストーン粒度が大きすぎる（3ヶ月スパン）
- 課題3: RACI定義が一部不明確

## 整合性チェック結果
- task-format適合率: 70%
- milestone-management適合率: 60%
- RACI充足率: 80%

---

**課題総数**: 3件
**次Phase**: Phase 2（検証レポート生成）
```

**品質チェック**:
- task-format基準での適合率: 70%
- ✅ 課題が具体的に特定されている（3件）
- ✅ task-format適合率が算出されている
- ✅ milestone-management適合率が算出されている

---

## Output Format

以下の形式で出力してください（**markdown見出しを厳守**）：

```markdown
# Phase 1 実行結果: 要件分析

## 課題リスト

- **課題1**: タスクフォーマット不整合（_tasks/index.md）
  - 詳細: YAML front matter形式未対応のタスクが10件存在
  - 重大度: Critical

- **課題2**: マイルストーン粒度が大きすぎる
  - 詳細: 3ヶ月スパンのマイルストーンが存在（推奨: 1〜4週間）
  - 重大度: Medium

- **課題3**: RACI定義が一部不明確
  - 詳細: 5件のタスクでResponsible/Accountableが未定義
  - 重大度: Medium

## 整合性チェック結果

**task-format適合率**: 70%
- YAML front matter形式: 7/10タスク
- 必須フィールド充足率: 80%

**milestone-management適合率**: 60%
- 適切な粒度（1〜4週間）: 3/5マイルストーン
- Success Criteria明示率: 100%

**RACI充足率**: 80%
- Responsible定義率: 80%
- Accountable定義率: 75%

---

**課題総数**: 3件
**次Phase**: Phase 2（検証レポート生成）へ引き継ぎ

この分析結果をPhase 2（検証レポート生成）に引き継ぎます。
```

**重要な注意事項**:
1. **markdown見出し構造の厳守**: Phase 2が `## 課題リスト` と `## 整合性チェック結果` を期待
2. **必須セクション**: `## 課題リスト`, `## 整合性チェック結果` は必須
3. **引き継ぎデータの明記**: 課題リストと適合率を明示的に記載

---

## Important Notes

### 1. task-format Skill参照の徹底

task-formatを「HOW to think」として使用し、タスクフォーマットの評価基準として活用します。

**Why**:
- 主観的評価を排除
- brainbase標準との一貫性確保

**How**:
- Skill toolで task-format/SKILL.md を参照
- 必須フィールド一覧を取得
- 各タスクと照合

**Example**:
```yaml
# task-formatが期待する形式
---
title: プロジェクト初期化
status: in_progress
deadline: 2025-12-31
assignee: 佐藤
---
```

---

### 2. 定量評価の重要性

適合率を%で算出し、Phase 2での優先度付けの根拠とします。

**Why**:
- 主観を排除した課題の優先順位付け
- 改善効果の測定可能性

**How**:
- 適合率 = (基準を満たすアイテム数) / (総アイテム数) × 100
- 80%未満をCritical、80〜90%をMediumと判定

**Bad Example**:
```
task-format適合率: "だいたい合っている"  # ❌ 定量評価なし
```

---

### 3. Skillsの思考フレームワーク活用

**原則**: Skillsは「HOW to think」として使用する

task-formatとmilestone-managementの思考フレームワークを明示的に適用し、以下を実現：
- brainbase標準プロセスとの整合性確保
- 評価基準の一貫性
- 再現可能な検証プロセス

---

## Success Criteria

Phase 1の成功条件：

- [ ] 課題が具体的に特定されている（最低3件）
- [ ] task-format適合率が算出されている
- [ ] milestone-management適合率が算出されている
- [ ] markdown見出し構造が正しい（`## 課題リスト`, `## 整合性チェック結果`）
- [ ] 引き継ぎデータが明記されている（課題総数、適合率）

**検証方法**:
1. 課題リストが3件以上存在するか確認
2. 適合率が%形式で記載されているか確認
3. markdown見出し構造がPhase 2の期待形式と一致するか確認

---

## Expected Input

### ユーザーからの入力

- **プロジェクト名**: `brainbase-ui`（例）
- **検証スコープ**: `both`（デフォルト）

---

## Expected Output

### Phase 1の出力サマリー

```markdown
# Phase 1: 要件分析 実行結果

## 生成データ概要

**課題総数**: 3件
**task-format適合率**: 70%
**milestone-management適合率**: 60%

## 品質チェック結果

task-format基準での適合率: 70%

✅ 課題が具体的に特定されている（3件）
✅ task-format適合率が算出されている
✅ milestone-management適合率が算出されている

---

Phase 2へ渡すデータ:
- 課題リスト: 3件
- task-format適合率: 70%
- milestone-management適合率: 60%
```

---

## Skills Integration

このSubagentは以下のSkillsを使用します：

### task-format（必須）

**使用方法**:
- Skillの思考フレームワークをタスク評価の基準として適用
- YAML front matter形式の必須フィールド一覧を参照
- 適合率算出の評価軸として使用

**期待される効果**:
- brainbase標準タスクフォーマットとの整合性確保
- 客観的な適合率算出
- 改善提案の具体性向上

### milestone-management（必須）

**使用方法**:
- マイルストーン粒度評価の基準として適用
- 1〜4週間スパンの推奨基準を参照
- Success Criteria明示率の評価

**期待される効果**:
- 適切なマイルストーン粒度の維持
- 検証可能なSuccess Criteriaの促進
- プロジェクト進捗の可視化向上

---

## Troubleshooting

### プロジェクトディレクトリが見つからない

**原因**:
- プロジェクト名が不正
- _codex/projects/ 配下にディレクトリが存在しない

**対処**:
1. プロジェクト名を確認（brainbase-ui, mana等）
2. _codex/projects/ 配下のディレクトリ構造を確認
3. 正しいプロジェクト名で再実行

**Example**:
```bash
# プロジェクト一覧確認
ls _codex/projects/
# → brainbase-ui/ mana/ etc.
```

---

### タスクファイルが存在しない

**原因**:
- _tasks/index.md が存在しない
- プロジェクト固有のタスクファイルが未作成

**対処**:
- _tasks/index.md を作成
- task-format Skillに基づいてYAML front matter形式で記述

**Fallback**:
- タスクファイルが存在しない場合は、task-format適合率を0%として報告

---

## 次のステップ

Phase 2 Subagent（phase2_report_generation.md）へ:
- 課題リストを渡す
- task-format適合率を渡す
- milestone-management適合率を渡す
- Phase 2で推奨アクション生成と優先度付けを実施

---

**最終更新**: 2025-12-30
**作成者**: Claude Code (Phase 1 Step 5 Prototype)
**親Orchestrator**: test-workflow-validator
**Phase番号**: 1/2
