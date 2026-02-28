---
name: test-workflow-validator
description: brainbaseワークフロー検証用Orchestrator。要件分析→検証レポート生成の2 Phase workflowでプロジェクトワークフローの課題を特定。
---

# Test Workflow Validator: brainbaseワークフロー検証

**バージョン**: 1.0.0
**最終更新**: 2025-12-30
**Orchestrator**: Yes (2 Phase workflow)

---

## Triggers

このSkillは以下の場合に使用します：

- プロジェクトワークフローの課題を特定したいとき
- brainbase標準プロセスとの整合性を確認したいとき
- ワークフロー改善の推奨アクションを知りたいとき

**例**:
```
User: "このプロジェクトのワークフローを検証して"
User: "brainbase標準と比較して課題を洗い出して"
```

---

## Orchestration Overview

このOrchestratorは**2 Phase workflow**でプロジェクトワークフローの検証を自動化します。

### ワークフロー構成

```
Phase 1: 要件分析
└── agents/phase1_requirements_analysis.md
    └── Skills: [task-format, milestone-management]
    └── Output: 課題リスト、整合性チェック結果

Phase 2: 検証レポート生成
└── agents/phase2_report_generation.md
    └── Skills: [principles]
    └── Input: 課題リスト（Phase 1から）
    └── Output: 検証レポート（課題 + 推奨アクション）
```

### データフロー

```
User Input: プロジェクト名
    ↓
Phase 1: 要件分析
    ↓ (markdown見出し構造で受け渡し)
Phase 2: 検証レポート生成
    ↓
Final Output: 検証レポート（課題リスト + 推奨アクション）
```

---

## 使い方

### 基本的な使用方法

```
User: "brainbase-uiプロジェクトのワークフローを検証して"
Claude Code: [test-workflow-validatorを起動]

→ Phase 1実行（要件分析） → Phase 2実行（検証レポート生成） → 完了
```

### 入力パラメータ

| パラメータ | 必須/任意 | 説明 | 例 |
|-----------|----------|------|-----|
| プロジェクト名 | 必須 | 検証対象のプロジェクト名 | `brainbase-ui` |
| 検証スコープ | 任意 | タスク/マイルストーン/両方 | `both`（デフォルト） |

### 出力形式

```markdown
# {プロジェクト名} ワークフロー検証レポート

## 課題サマリー
- 課題総数: X件
- 重大度別: Critical Y件、Medium Z件

## 詳細課題リスト
{課題の詳細...}

## 推奨アクション
{優先度付き改善提案...}

---
**作成日**: YYYY-MM-DD
**Phase数**: 2
```

---

## Phase詳細

### Phase 1: 要件分析

**Subagent**: `agents/phase1_requirements_analysis.md`

**目的**: プロジェクトの既存ワークフロー（タスク、マイルストーン）を調査し、brainbase標準との整合性をチェック

**使用Skills**:
- `task-format`: タスク管理標準フォーマットとの照合
- `milestone-management`: マイルストーン管理ルールとの照合

**入力**:
- プロジェクト名
- _codex/projects/{project}/ 配下のファイル

**出力**:
```markdown
## 課題リスト
- 課題1: タスクフォーマット不整合
- 課題2: マイルストーン粒度が大きすぎる

## 整合性チェック結果
- task-format適合率: 70%
- milestone-management適合率: 60%
```

**Success Criteria**:
- [ ] 課題が具体的に特定されている（最低3件）
- [ ] task-format適合率が算出されている
- [ ] milestone-management適合率が算出されている

---

### Phase 2: 検証レポート生成

**Subagent**: `agents/phase2_report_generation.md`

**目的**: Phase 1で特定した課題に対して、推奨アクションを含む検証レポートを生成

**使用Skills**:
- `principles`: brainbase価値観に基づいた優先度付け

**入力** (Phase 1から):
- `## 課題リスト`: 特定された課題
- `## 整合性チェック結果`: 適合率

**出力**:
```markdown
## 検証レポート

### 課題サマリー
- 課題総数: X件
- 重大度別: Critical Y件、Medium Z件

### 推奨アクション
1. タスクフォーマット統一（優先度: P0）
2. マイルストーン粒度見直し（優先度: P1）
```

**Success Criteria**:
- [ ] 課題が重大度別に分類されている
- [ ] 各課題に推奨アクションが明記されている
- [ ] 優先度（P0/P1/P2）が付与されている

---

## Orchestrator Responsibilities

### Phase Management

**各Phaseの完了を確認**:
- Phase 1の成果物が存在するか（課題リスト、整合性チェック結果）
- Phase 2の成果物が存在するか（検証レポート）

**Phase間のデータ受け渡しを管理**:
- Phase 1の課題リスト・整合性チェック結果をPhase 2に渡す
- プロジェクト名を引き継ぐ

---

### Review & Replan

**Review実施** (各Phase完了後):

1. **ファイル存在確認**
   - Phase 1成果物: 課題リスト、整合性チェック結果（markdown形式）
   - Phase 2成果物: 検証レポート（課題 + 推奨アクション）

2. **Success Criteriaチェック**
   - **Phase 1**:
     - SC-1: 課題が具体的に特定されている（最低3件）
     - SC-2: task-format適合率が算出されている
     - SC-3: milestone-management適合率が算出されている
   - **Phase 2**:
     - SC-1: 課題が重大度別に分類されている
     - SC-2: 各課題に推奨アクションが明記されている
     - SC-3: 優先度（P0/P1/P2）が付与されている

3. **差分分析**
   - **Phase 1**: task-format, milestone-management基準への準拠
   - **Phase 2**: principles基準への準拠（優先度付け）
   - 両成果物の整合性確認

4. **リスク判定**
   - **Critical**: リプラン実行（Subagentへ修正指示）
     - 課題が3件未満
     - 適合率が未算出
     - Skills基準への重大な違反
     - 次Phaseの実行に影響する問題
   - **Minor**: 警告+進行許可
     - 軽微な表記ゆれ等
   - **None**: 承認（次Phaseへ）

**Replan実行** (Critical判定時):

1. **Issue Detection（問題検出）**
   - Success Criteriaの不合格項目を特定
   - 差分の詳細化（期待値 vs 実際）

2. **Feedback Generation（フィードバック生成）**
   - 何が要件と異なるか
   - どう修正すべきか（task-format/milestone-management/principles基準の参照）
   - 修正チェックリストの作成

3. **Replan Prompt Creation（リプランプロンプト作成）**
   - 元のタスク + フィードバック
   - Success Criteriaの再定義

4. **Subagent Re-execution（Subagent再実行）**
   - Task Tool経由で `agents/phase1_requirements_analysis.md` または `agents/phase2_report_generation.md` を再起動
   - リプランプロンプトを入力
   - 修正成果物を取得

5. **Re-Review（再レビュー）**
   - 修正成果物を同じ基準で再評価
   - **PASS** → 次Phaseへ（またはPhase 2の場合は完了）
   - **FAIL** → リトライカウント確認
     - リトライ < Max (3回) → ステップ1へ戻る
     - リトライ >= Max (3回) → 人間へエスカレーション（AskUserQuestion）

**Max Retries管理**:
- 各Phaseで最大3回までリプラン実行可能
- 3回超過時は人間（佐藤）へエスカレーション
- エスカレーション内容:
  - 何が問題か（Success Criteria不合格項目）
  - どう修正を試みたか（リプラン履歴）
  - 人間の判断が必要な理由

---

### Error Handling

**Phase実行失敗時のフォールバック**:
- Subagent起動失敗 → Task Tool再実行（1回）
- Skills読み込み失敗 → Skills存在確認 + ユーザーへ通知

**データ不足時の追加情報取得**:
- プロジェクト情報不足 → AskUserQuestion（プロジェクト名等）
- _codex/projects/{project}/が存在しない → ユーザーへ質問

**Max Retries超過時の人間へのエスカレーション**:
- 3回のリプラン実行後も基準を満たさない → AskUserQuestion
- 質問内容: 問題の詳細、リプラン履歴、人間の判断を求める理由

**やらないこと**:
- Phase内部のロジックには介入しない（各SubagentがPhase内のロジックを担当）
- ユーザー入力を直接処理しない（Phase 1 Subagentに委譲）
- 最終出力の整形は行わない（最終PhaseのSubagentが整形を担当）

---

## Expected Output

### 成功時

```markdown
# brainbase-ui ワークフロー検証レポート

**作成日**: 2025-12-30
**Phase数**: 2
**実行時間**: 3分

## 課題サマリー

**課題総数**: 5件
**重大度別**: Critical 2件、Medium 3件

## 詳細課題リスト

### Critical
1. タスクフォーマット不整合（_tasks/index.md）
2. マイルストーン粒度が大きすぎる（3ヶ月スパン）

### Medium
3. RACI定義が一部不明確
4. タスク期限が未設定（3件）
5. マイルストーン間の依存関係が未定義

## 推奨アクション

1. **タスクフォーマット統一**（優先度: P0）
   - task-format Skill準拠に修正
   - YAML front matter標準化

2. **マイルストーン粒度見直し**（優先度: P1）
   - 3ヶ月 → 1ヶ月単位に分割
   - 検証可能なSuccess Criteria追加

---

**Success Criteria達成率**: 100%

✅ Phase 1: 要件分析 - 完了（課題5件特定、適合率70%）
✅ Phase 2: 検証レポート生成 - 完了（推奨アクション2件）
```

### エラー時

```markdown
# test-workflow-validator 実行エラー

**Phase**: Phase 1
**エラー内容**: _codex/projects/brainbase-ui/ が見つかりません

## 原因

プロジェクト名が不正、またはプロジェクトディレクトリが存在しません。

## 対処方法

1. プロジェクト名を確認してください（例: brainbase-ui, mana, brainbase）
2. _codex/projects/ 配下にプロジェクトディレクトリが存在するか確認
3. 正しいプロジェクト名で再実行

## ログ

```
[Phase 1] プロジェクトディレクトリ読み込み失敗
Path: /Users/ksato/workspace/_codex/projects/brainbase-ui/
Error: ENOENT: no such file or directory
```
```

---

## Troubleshooting

### Phase 1で失敗する

**症状**: "_codex/projects/{project}/ が見つかりません" エラー

**原因**:
- プロジェクト名が不正
- プロジェクトディレクトリが存在しない
- _codex/projects/ 配下にファイルが配置されていない

**対処**:
1. プロジェクト名を確認（brainbase-ui, mana等）
2. _codex/projects/ 配下のディレクトリ構造を確認
3. 必要に応じて01_strategy.md等の必須ファイルを作成

---

### Phase間のデータ受け渡しが失敗する

**症状**: Phase 2で「Phase 1の出力が見つからない」エラー

**原因**:
- Phase 1のSuccess Criteriaが未達成
- markdown見出し構造の不一致
- 必須フィールドの欠損

**対処**:
1. Phase 1のSuccess Criteriaを確認
2. Phase 1の出力形式を確認（markdown見出しが正しいか）
3. Subagent定義の`Output Format`セクションを見直す

---

### 途中でユーザー入力が必要になる

**症状**: Phase実行中に「不足情報があります」と表示される

**対処**:
- AskUserQuestion toolで質問が表示されるので回答する
- 回答後、自動的に次のPhaseに進む

---

## Success Criteria

Orchestrator全体の成功条件：

- [ ] 全Phase（Phase 1〜2）が完了
- [ ] 各PhaseのSuccess Criteriaが100%達成
- [ ] 最終出力が期待形式で生成されている
- [ ] エラーが発生していない（またはハンドリングされている）
- [ ] 課題が最低3件以上特定されている
- [ ] 推奨アクションに優先度（P0/P1/P2）が付与されている

---

## 関連ファイル

### Subagent定義
```
.claude/skills/test-workflow-validator/
├── SKILL.md                              # このファイル
└── agents/
    ├── phase1_requirements_analysis.md   # Phase 1 Subagent
    └── phase2_report_generation.md       # Phase 2 Subagent
```

### 参照ファイル（プロジェクト固有）
```
{プロジェクトルート}/
├── _codex/
│   └── projects/
│       └── {project}/
│           ├── 01_strategy.md       # Phase 1で参照
│           ├── 02_raci.md           # Phase 1で参照
│           └── 03_tasks.md          # Phase 1で参照
└── _tasks/
    └── index.md                     # Phase 1で参照
```

---

## 参照Skills

このOrchestratorが使用する共通Skills：

- **task-format** (`/Users/ksato/workspace/.claude/skills/task-format/SKILL.md`)
  - 役割: brainbaseタスク管理標準フォーマット定義
  - 使用Phase: Phase 1

- **milestone-management** (`/Users/ksato/workspace/.claude/skills/milestone-management/SKILL.md`)
  - 役割: brainbaseマイルストーン管理ルール定義
  - 使用Phase: Phase 1

- **principles** (`/Users/ksato/workspace/.claude/skills/principles/SKILL.md`)
  - 役割: brainbase価値観・判断基準（優先度付けに使用）
  - 使用Phase: Phase 2

---

## 開発ガイド

### 新規Phaseの追加方法

1. **Subagent定義を作成**
   ```bash
   cp .claude/skills/_templates/subagent.phase.md.template \
      .claude/skills/test-workflow-validator/agents/phase{N}_{action}.md
   ```

2. **SKILL.mdに追記**
   - `Orchestration Overview`にPhase追加
   - `Phase詳細`セクションに詳細追加

3. **データフローの更新**
   - 前Phaseの出力を入力として定義
   - Success Criteriaを明確化

4. **テスト**
   - Phase単体でテスト
   - 全Phase通してテスト

### Subagent定義のベストプラクティス

- **single responsibility**: 1 Phaseで1つの責任のみ
- **明確な入出力**: markdown見出し構造で明示
- **Success Criteria**: 具体的かつ検証可能な条件
- **Skillsの活用**: 思考フレームワークとして参照

---

## バージョン履歴

### v1.0.0 (2025-12-30)
- 初版作成
- Phase 1-2実装
- task-format, milestone-management, principles Skills統合

---

**最終更新**: 2025-12-30
**作成者**: Claude Code (Phase 1 Step 5 Prototype)
**ステータス**: Active (Prototype)
