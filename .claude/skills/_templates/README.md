# Orchestrator & Subagent テンプレート

**バージョン**: 1.0.0
**最終更新**: 2025-12-30
**目的**: 高品質なOrchestrator Skillsを標準化されたフォーマットで作成

---

## 📋 概要

このディレクトリには、brainbaseにおけるOrchestrator Skills（Multi-Phase Workflow）とSubagent定義の標準テンプレートが含まれています。

**テンプレート一覧**:
1. `SKILL.orchestrator.md.template` - Orchestrator SKILL.md のテンプレート
2. `subagent.phase.md.template` - Subagent定義のテンプレート
3. `README.md` - このファイル（使用ガイド）

---

## 🎯 テンプレートの目的

### 問題意識

Phase 1の分析により、以下の課題が発見されました：
- **Skills粒度**: 68個中55個（81%）が小さすぎる（<300行）
- **標準化不足**: Orchestrator間でフォーマットに微妙な差異
- **学習曲線**: 新規Orchestrator作成時のベストプラクティスが不明確

### 解決策

既存の優れたOrchestrator（sns-smart、marketing-strategy-planner、90day-checklist）から共通パターンを抽出し、標準テンプレート化。

**期待される効果**:
- **保守性向上**: 統一されたフォーマットによる可読性向上
- **開発速度向上**: テンプレートから開始することで設計時間を短縮
- **品質向上**: ベストプラクティスが組み込まれたテンプレート

---

## 📐 設計原則

### 1. Orchest ratorパターン

**定義**: 複数のSubagent（Phase）を順次実行し、Phase間でデータを受け渡すワークフロー

**特徴**:
- **Multi-Phase**: 2〜5 Phaseの段階的処理
- **データフロー**: markdown見出し構造でPhase間データ受け渡し
- **Success Criteria**: 各Phaseに明確な成功条件
- **Skills統合**: 共通Skillsを思考フレームワークとして活用

**例**:
- `sns-smart` (3.5 Phase): ターゲット分析 → ドラフト作成 → スタイルレビュー → 画像プロンプト
- `marketing-strategy-planner` (3 Phase): WHO×WHAT → 戦術選定 → 実行計画
- `90day-checklist` (2 Phase): 戦略策定 → RACI定義

---

### 2. Subagent定義の標準フォーマット

**frontmatter**:
```yaml
---
name: phase{N}_{action}
description: {1行の簡潔な説明}
tools:
  - Read
  - Write
  - Skill
  - AskUserQuestion
  - Grep
  - Glob
  - Bash
skills: [{skill-1}, {skill-2}]
model: claude-sonnet-4-5-20250929
---
```

**標準化のポイント**:
- ✅ `tools:` 形式を採用（`allowed_tools:` ではない）
  - 理由: より明示的、`model:` フィールドとの親和性
- ✅ `model: claude-sonnet-4-5-20250929` をデフォルトとして明記
  - 理由: Phase単位でモデル選択可能（quick taskはclaude-haiku-4-5-20251001等）
- ✅ `skills: [...]` で依存Skillsを明示
  - 理由: 思考フレームワークとしての依存関係を可視化

---

### 3. Phase間データ受け渡し仕様

**原則**: markdown見出し構造を厳守

**Phase {N} の出力例**:
```markdown
# Phase {N} 実行結果: {Title}

## セクション1
{データ...}

## セクション2
{データ...}

## 次Phaseへの引き継ぎ
- データ1: 値
- データ2: 値
```

**Phase {N+1} の入力期待**:
```markdown
前Phase（Phase {N}）の出力から以下を参照：
- `## セクション1` → データ1を抽出
- `## セクション2` → データ2を抽出
```

**重要**: 見出しレベル（`##` vs `###`）と名前を厳密に一致させる

---

### 4. Success Criteria設計

**原則**: 具体的かつ検証可能な条件

**Good Example**:
```markdown
## Success Criteria

- [ ] N=1ペルソナが具体的に設定されている（役職・立場・課題が明確）
- [ ] 9セグマップ上の位置が判定されている
- [ ] 顧客心理フロー（認知→理解→信頼→行動）が判定されている
- [ ] 「悩み」「判断」「結果」が推測されている
```

**Bad Example**:
```markdown
## Success Criteria

- [ ] 分析が完了している ❌ 抽象的
- [ ] 良い結果が得られている ❌ 主観的
```

---

## 🚀 使い方

### Step 1: 新規Orchestrator Skillの作成

```bash
# 1. Skillディレクトリを作成
mkdir -p /Users/ksato/workspace/.claude/skills/{your-skill-name}/agents

# 2. Orchestrator SKILL.mdをコピー
cp /Users/ksato/workspace/.claude/skills/_templates/SKILL.orchestrator.md.template \
   /Users/ksato/workspace/.claude/skills/{your-skill-name}/SKILL.md

# 3. エディタで開く
code /Users/ksato/workspace/.claude/skills/{your-skill-name}/SKILL.md
```

---

### Step 2: SKILL.mdのプレースホルダーを置換

**置換すべきプレースホルダー**:

| プレースホルダー | 説明 | 例 |
|----------------|------|-----|
| `{skill-name}` | Skill名（kebab-case） | `marketing-strategy-planner` |
| `{Skill Name}` | Skill名（Title Case） | `Marketing Strategy Planner` |
| `{N}` | Phase総数 | `3` |
| `{Phase 1の目的}` | Phase 1の簡潔な目的 | `WHO×WHAT分析` |
| `{skill-1}` | 使用するSkill名 | `marketing-compass` |
| `{YYYY-MM-DD}` | 作成日 | `2025-12-30` |

**置換例**:
```markdown
# Before
name: {skill-name}
description: {簡潔な説明}

# After
name: marketing-strategy-planner
description: マーケティング戦略を立案する3 Phase Orchestrator
```

---

### Step 3: 各Phaseの Subagent定義を作成

```bash
# Phase 1 Subagent作成
cp /Users/ksato/workspace/.claude/skills/_templates/subagent.phase.md.template \
   /Users/ksato/workspace/.claude/skills/{your-skill-name}/agents/phase1_{action}.md

# Phase 2 Subagent作成
cp /Users/ksato/workspace/.claude/skills/_templates/subagent.phase.md.template \
   /Users/ksato/workspace/.claude/skills/{your-skill-name}/agents/phase2_{action}.md

# Phase N Subagent作成
cp /Users/ksato/workspace/.claude/skills/_templates/subagent.phase.md.template \
   /Users/ksato/workspace/.claude/skills/{your-skill-name}/agents/phase{N}_{action}.md
```

---

### Step 4: Subagent定義のプレースホルダーを置換

**phase1_who_what.md の例**:

```yaml
# Before
---
name: phase{N}_{action}
description: {このPhaseの目的を1行で簡潔に記述}
tools:
  - Read
  - Write
skills: [{skill-1}, {skill-2}]
model: claude-sonnet-4-5-20250929
---

# After
---
name: phase1_who_what
description: プロジェクトのWHO×WHATマトリクスを生成する
tools:
  - Read
  - Write
  - Skill
  - AskUserQuestion
  - Glob
  - Grep
skills: [marketing-compass, strategy-template]
model: claude-sonnet-4-5-20250929
---
```

---

### Step 5: データフローの設計

**Phase間のデータ受け渡しを明確化**:

**Phase 1の出力形式を定義**:
```markdown
## Output Format

```markdown
# Phase 1 実行結果: WHO×WHAT分析

## WHO×WHATマトリクス
{マトリクスデータ}

## セグメント別優先度
{優先度データ}

## 次Phaseへの引き継ぎ
- プロジェクト名: {project}
- WHO×WHATマトリクス: {上記セクション参照}
- セグメント別優先度: {上記セクション参照}
\```
```

**Phase 2の入力期待を定義**:
```markdown
## Expected Input

### 前Phase（Phase 1）からの出力

```markdown
## WHO×WHATマトリクス
{Phase 1で生成されたマトリクス}

## セグメント別優先度
{Phase 1で生成された優先度}
\```
```

---

### Step 6: Success Criteriaの定義

**各Phaseに具体的な成功条件を設定**:

```markdown
## Success Criteria

- [ ] {具体的条件1}（検証可能な形で）
- [ ] {具体的条件2}（定量的に）
- [ ] {具体的条件3}（明確な基準で）
```

**例**（sns-smart Phase 1）:
```markdown
## Success Criteria

- [ ] N=1ペルソナが具体的に設定されている（役職・立場・課題が明確）
- [ ] 9セグマップ上の位置が判断されている
- [ ] 顧客心理フロー（認知→理解→信頼→行動）が判定されている
- [ ] 「悩み」「判断」「結果」が推測されている
- [ ] 訴求ポイントが明確化されている
- [ ] 推奨構文が選定されている（理由付き）
```

---

### Step 7: Skills統合の設計

**Skillsを「思考フレームワーク」として活用**:

```markdown
## Thinking Framework

### {Skill-1} Skillの思考フレームワークを活用

{Skill-1}が提供する「{思考パターン名}」を使用して{タスク}を実行します：

**フレームワークの概要**:
1. **WHO×WHATの関係**
   - WHO（お客様）とWHAT（プロダクト）の組み合わせが価値を提供
   - HOW（手法/ツール）に溺れず、WHO×WHATから出発

2. **価値の構造**
   - 価値 = 便益（買う理由）× 独自性（ほかを選ばない理由）

**思考パターン**:
```
新規プロダクト企画 → 「WHO×WHATは明確か?」
施策が散らばる → 「WHO×WHATに立ち返れるか?」
\```
```

---

### Step 8: テストとデバッグ

**1. Phase単体テスト**:
```bash
# Subagent定義を直接読み込ませてテスト
# （実際のOrchestratorから呼ばれる前に）
```

**2. Orchestrator全体テスト**:
```bash
# Claude Codeセッションを再起動
# Skillを呼び出してワークフロー確認
```

**3. デバッグ**:
- Success Criteriaが達成されているか確認
- Phase間のデータ受け渡しが正しいか確認
- markdown見出し構造が期待通りか確認

---

## 📚 ベストプラクティス

### 1. Phase粒度

**Good**:
- 1 Phase = 1つの明確な責任
- Phase実行時間: 2〜5分程度
- Phase数: 2〜5個（多くても5個まで）

**Bad**:
- 1 Phaseで複数の異なるタスクを実行 ❌
- Phase数が多すぎる（7個以上） ❌
- 1 Phaseの実行時間が長すぎる（10分以上） ❌

---

### 2. Skillsの活用

**Good**:
- Skillsを「HOW to think」として活用
- `skills: [skill-name]` で明示的に宣言
- Thinking Frameworkセクションで具体的な使用方法を記述

**Bad**:
- Skillsを単なるデータファイルとして参照 ❌
- Skills依存を暗黙的にする ❌
- Skillsの思考パターンを活用しない ❌

---

### 3. エラーハンドリング

**Good**:
- 各Phaseで必須データの検証
- AskUserQuestionで不足情報を補完
- Troubleshootingセクションで典型的な問題を記載

**Bad**:
- バリデーションなしで次Phaseに進む ❌
- エラー時のフォールバックがない ❌
- ユーザーへのエラーメッセージが不明確 ❌

---

### 4. ドキュメント品質

**Good**:
- Success Criteriaが具体的
- 例が豊富（Good/Bad Example）
- Troubleshootingが充実

**Bad**:
- 抽象的な説明のみ ❌
- 例がない ❌
- Troubleshootingセクションが空 ❌

---

## 🔧 トラブルシューティング

### Phase間のデータ受け渡しが失敗する

**症状**: Phase 2で「Phase 1の出力が見つからない」エラー

**原因**:
- markdown見出し構造の不一致
- Phase 1のSuccess Criteriaが未達成
- 必須フィールドの欠損

**対処**:
1. Phase 1の`Output Format`セクションを確認
2. Phase 2の`Expected Input`セクションと一致しているか確認
3. markdown見出しレベル（`##` vs `###`）と名前を厳密にチェック

---

### Skillsが正しく参照されない

**症状**: 「Skill {skill-name} が見つかりません」エラー

**原因**:
- Skill名のスペルミス
- Skillsが存在しない
- `skills: [...]` フィールドの記述ミス

**対処**:
1. `.claude/skills/` ディレクトリにSkillが存在するか確認
   ```bash
   ls -la /Users/ksato/workspace/.claude/skills/{skill-name}/
   ```
2. frontmatterの`skills:`フィールドを確認
3. Skill名が正しいか確認（kebab-case）

---

### Success Criteriaが達成できない

**症状**: Phaseが完了しても品質が低い

**原因**:
- Success Criteriaが抽象的すぎる
- 検証可能な条件になっていない
- Thinking Frameworkが正しく適用されていない

**対処**:
1. Success Criteriaを具体化
   - 「分析が完了している」 → 「N=1ペルソナが具体的に設定されている（役職・立場・課題が明確）」
2. 定量的な基準を追加
   - 「品質が高い」 → 「{Skill}基準での適合率80%以上」
3. Thinking Frameworkの適用を強化
   - `## Thinking Framework` セクションを充実させる

---

## 📖 参照リソース

### 内部ドキュメント

- **Orchestrator開発ガイド**: `docs/skills/orchestrator-guide.md`（作成予定 - Step 4）
- **Cross-Skill参照仕様書**: `docs/skills/cross-skill-reference.md`（作成予定 - Step 4）
- **リファクタリング計画**: `docs/REFACTORING_PLAN.md`

### 既存Orchestrator例

**sns-smart** (3.5 Phase, 430行):
- パス: `/Users/ksato/workspace/.claude/skills/sns-smart/`
- 特徴: 最も複雑なワークフロー、Phase 2.5（スタイルレビュー）を含む
- 学べること: 細かいPhase分割、スタイルチェック実装

**marketing-strategy-planner** (3 Phase, 431行):
- パス: `/Users/ksato/workspace/.claude/skills/marketing-strategy-planner/`
- 特徴: ビジネス戦略系Orchestrator、WHO×WHAT分析
- 学べること: ビジネスフレームワークの活用、AskUserQuestion多用

**90day-checklist** (2 Phase, 461行):
- パス: `/Users/ksato/workspace/.claude/skills/90day-checklist/`
- 特徴: シンプルなワークフロー、最小構成
- 学べること: 最小限のPhase構成、明確なデータフロー

---

## 🎓 学習ガイド

### 初めてOrchestratorを作成する場合

**推奨手順**:
1. **既存Orchestratorを読む**（30分）
   - `90day-checklist`（最もシンプル）から開始
   - ワークフロー全体を理解

2. **テンプレートで新規作成**（1時間）
   - Step 1-7の手順に従う
   - 2 Phase構成から開始（シンプルに）

3. **既存パターンを参考にする**（30分）
   - `marketing-strategy-planner`のPhase 1を参考
   - WHO×WHAT分析のパターンを学ぶ

4. **テストとデバッグ**（30分）
   - Phase単体テスト
   - Orchestrator全体テスト

**合計時間**: 約2.5時間

---

### 複雑なワークフローを設計する場合

**推奨手順**:
1. **sns-smartを詳細分析**（1時間）
   - 3.5 Phase構成を理解
   - Phase 2.5（スタイルレビュー）の位置づけを学ぶ

2. **Phase粒度を設計**（30分）
   - 1 Phase = 1つの責任
   - Phase数は5個以内に抑える

3. **データフローを設計**（1時間）
   - 各Phaseの入出力を明確化
   - markdown見出し構造を厳密に定義

4. **Success Criteriaを具体化**（30分）
   - 検証可能な条件に
   - 定量的基準を含める

**合計時間**: 約3時間

---

## 🔄 バージョン履歴

### v1.0.0 (2025-12-30)
- 初版作成
- Phase 1（既存Orchestrators検証・標準化）完了
- Step 1-2（動作確認・構造分析）完了
- Step 3（テンプレート作成）完了
- SKILL.orchestrator.md.template 作成
- subagent.phase.md.template 作成
- README.md（このファイル）作成

---

**最終更新**: 2025-12-30
**作成者**: Claude Code (Phase 1 実装)
**ステータス**: Active
**次のステップ**: Step 4（ドキュメント執筆）へ
