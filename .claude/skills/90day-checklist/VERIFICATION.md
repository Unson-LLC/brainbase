# 90day-checklist Orchestrator 検証手順

**目的**: `{skill}/agents/`構造でのOrchestrator動作確認（90day-checklist v1.0）
**実施予定**: セッション再起動後
**検証者**: Claude Code (Sonnet 4.5)
**目標時間**: 30分
**期待結果**: ✅ 90day-checklist Orchestratorが動作し、01_strategy.md + RACIファイルを自動生成
**検証日**: 2025-12-26（再検証完了）

---

## 前提条件

- [x] 90day-checklist Orchestratorが実装済み（コミット: 3e0434d）
- [x] agents/phase1_strategy.md実装済み
- [x] agents/phase2_raci.md実装済み
- [x] SKILL.mdがOrchestrator形式に更新済み
- [ ] **セッション再起動**（Subagentsロードのため必須）

## 検証ステップ

### Step 1: Skills認識確認 ✅（事前確認）

**実施内容**:
```bash
# Skillsディレクトリ確認
ls -la /Users/ksato/workspace/.claude/skills/90day-checklist/

# Subagentsファイル確認（{skill}/agents/に配置されているか）
ls -la /Users/ksato/workspace/.claude/skills/90day-checklist/agents/phase1_strategy.md
ls -la /Users/ksato/workspace/.claude/skills/90day-checklist/agents/phase2_raci.md
```

**期待結果**:
```
.claude/skills/90day-checklist/
├── SKILL.md
├── VERIFICATION.md
└── agents/
    ├── phase1_strategy.md (90day-checklist Phase 1)
    └── phase2_raci.md (90day-checklist Phase 2)
```

### Step 2: セッション再起動（必須）

**重要**: Subagentファイル作成/変更後、**セッション再起動が必要**

**理由**: 公式ドキュメントより
> "Agents defined in `.claude/agents/` are loaded at startup only. If you create a new agent file while Claude Code is running, restart the session to load it."

**注意**: Subagentsは`{skill}/agents/`に配置するだけで認識される。`.claude/agents/`へのコピーは不要。

**手順**:
1. Subagentファイルが`.claude/skills/90day-checklist/agents/`に存在することを確認
2. Claude Codeセッションを終了
3. Claude Codeを再起動
4. `/Users/ksato/workspace`ディレクトリで新規セッション開始

### Step 3: Phase 1 Subagent実行

**実施内容**:
Task tool経由でphase1-strategy-generatorを起動

```
Task(
  subagent_type="phase1-strategy-generator",
  description="Phase 1戦略策定テスト",
  prompt="プロジェクト名: test-project の01_strategy.mdを生成してください。

【プロジェクト情報】
- プロダクト概要: AI営業支援ツール
- ターゲット: BtoB SaaS企業の営業マネージャー
- 提供価値: 営業ナレッジ一元化、成約率2倍

既存情報がない場合は、上記の基本情報を使用して生成してください。"
)
```

**期待結果**:
- ✅ phase1-strategy-generatorが正常起動
- ✅ strategy-template Skillの思考フレームワークを使用
- ✅ 01_strategy.md生成（`/Users/ksato/workspace/_codex/projects/test-project/01_strategy.md`）
- ✅ 品質チェック: strategy-template基準100%
- ✅ agentId返却（resume用）

**成果物確認**:
```bash
# 01_strategy.md生成確認
cat /Users/ksato/workspace/_codex/projects/test-project/01_strategy.md

# 必須項目チェック
# - プロダクト概要（30〜60文字）
# - ICP（業界・企業規模・役職）
# - 約束する価値（定量成果）
# - 価格・前受けルール
# - TTFV目標
# - 主要KPI（3〜5個、目標値付き）
# - 次のアクション（担当者・期限）
```

### Step 4: Phase 2 Subagent実行

**実施内容**:
Task tool経由でphase2-raci-generatorを起動

```
Task(
  subagent_type="phase2-raci-generator",
  description="Phase 2 RACI定義テスト",
  prompt="プロジェクト名: test-project のRACIファイルを生成してください。

Phase 1で生成された01_strategy.mdは以下のパスに存在します:
/Users/ksato/workspace/_codex/projects/test-project/01_strategy.md

【補足情報】
- 管轄法人: unson（雲孫合同会社）
- メンバー: sato_keigo（CEO）

01_strategy.mdの内容を基に、RACIファイルを生成してください。"
)
```

**期待結果**:
- ✅ phase2-raci-generatorが正常起動
- ✅ Phase 1の01_strategy.mdを読み込み
- ✅ raci-format Skillの思考フレームワークを使用
- ✅ RACIファイル生成/更新（`/Users/ksato/workspace/_codex/common/meta/raci/unson.md`）
- ✅ 品質チェック: raci-format基準100%
- ✅ agentId返却（resume用）

**成果物確認**:
```bash
# RACIファイル生成/更新確認
cat /Users/ksato/workspace/_codex/common/meta/raci/unson.md

# 必須項目チェック
# - フロントマター（org_id、name、members、updated）
# - 立ち位置（人・資産・権利の範囲）
# - 決裁（領域・決裁者）
# - 主な担当
# - 管轄プロダクト（test-projectが含まれているか）
```

### Step 5: コンテキスト分離確認

**検証方法**:
各SubagentがagentIdを持ち、独立して動作することを確認。

**期待結果**:
- ✅ Phase 1がagentId: `XXXXXXX`を持つ
- ✅ Phase 2がagentId: `YYYYYYY`を持つ
- ✅ 各SubagentがresumeパラメータでOS継続可能
- ✅ Phase 1の詳細（質問応答等）がメインセッションに残らない
- ✅ Phase 2がPhase 1のサマリーのみを受け取る

### Step 6: Skills制限確認

**検証方法**:
各Subagentの実行ログでSkills使用を確認。

**期待結果**:
- ✅ Phase 1: strategy-template, principles Skillsの思考フレームワークを適用
  - プロダクト概要の明確化
  - ICP定義
  - 価値の約束（定量成果含む）
  - KPI設計
  - brainbase原則（前受け100%等）
- ✅ Phase 2: raci-format, principles Skillsの思考フレームワークを適用
  - 立ち位置の明確化
  - 法人単位での管理
  - 決裁ラインの明確化
  - Accountable（A）は1人

---

## 成功基準 ✅

すべての確認ポイント（✅）がクリアされること：

- [ ] 90day-checklist Skillsが認識されている
- [ ] phase1-strategy-generatorが起動する
- [ ] phase2-raci-generatorが起動する
- [ ] Phase 1で01_strategy.mdが生成される
- [ ] Phase 2でRACIファイルが生成/更新される
- [ ] strategy-template Skillが使用される
- [ ] raci-format Skillが使用される
- [ ] 両Phaseのコンテキストが分離されている
- [ ] 成果物品質が基準100%

---

## 次のステップ

### 検証成功時

1. **検証レポート作成**
   - 実行ログ保存
   - 成果物の品質評価
   - 発見事項の文書化

2. **実業務での使用開始**
   - 既存プロジェクトの01_strategy整備
   - 新規プロジェクトでの活用

3. **v2.0設計開始**
   - Phase 3-4追加
   - 並列実行パターンの設計
   - 全10項目の自動化計画

### 検証失敗時

失敗パターン別の対処法は、SKILL.mdの「Troubleshooting」セクションを参照。

---

## 失敗時の対処

### 失敗パターン1: Subagentsが認識されない

**症状**:
- 90day-checklistは認識されるが、Subagentsが起動しない
- "Subagent not found" エラー

**原因候補**:
- **セッション再起動が未実施**（最も可能性が高い）
- Subagent定義ファイルのフォーマットエラー
- ファイル名と name フィールドの不一致

**対処**:
```bash
# ファイル配置確認（{skill}/agents/に存在するか）
ls -la /Users/ksato/workspace/.claude/skills/90day-checklist/agents/phase1_strategy.md
ls -la /Users/ksato/workspace/.claude/skills/90day-checklist/agents/phase2_raci.md

# フロントマター確認
head -10 .claude/skills/90day-checklist/agents/phase1_strategy.md
# → name: phase1-strategy-generator が正しいか

# セッション再起動（最も可能性が高い）
# Claude Codeを再起動してから再試行
```

### 失敗パターン2: Subagentsが起動するがSkillsが使用されない

**症状**:
- Subagentsは起動する
- しかしstrategy-template/raci-format Skillsが使用されない

**原因候補**:
- Skills設定（settingSources）が未設定
- Subagent内でのSkills呼び出しが機能していない

**対処**:
```bash
# Skills設定確認
# settingSources: ["user", "project"]が設定されているか

# skills_mapping.json確認
cat /Users/ksato/workspace/_codex/common/meta/skills_mapping.json | grep -E "strategy-template|raci-format"
```

### 失敗パターン3: コンテキスト分離されない

**症状**:
- Subagentsは起動する
- しかしメインセッションのコンテキストに全てのSubagentデータが残る

**原因候補**:
- Subagentsの実装方法が想定と異なる
- コンテキスト分離が機能していない

**対処**:
- Subagentの定義を見直す
- `tools`フィールドでツール制限を強化
- test-orchestratorと比較検証

### 失敗パターン4: 成果物の品質が低い

**症状**:
- 成果物は生成される
- しかしstrategy-template/raci-format基準に準拠していない

**原因候補**:
- ユーザーへの質問が不十分
- Skills思考フレームワークが適用されていない

**対処**:
- AskUserQuestion toolの使用を強化
- Subagent内でSkills装備を明示
- 品質チェックロジックを強化

---

## 検証レポートテンプレート

検証後、以下のテンプレートで結果を記録：

```markdown
# 90day-checklist Orchestrator 検証レポート

**実施日**: YYYY-MM-DD
**実施者**: Claude Code
**所要時間**: XX分

## 検証結果サマリー

- **.claude/agents/配置**: ✅ 成功 / ❌ 失敗
- **Subagents起動**: ✅ 成功 / ❌ 失敗
- **Skills使用**: ✅ 成功 / ❌ 失敗
- **コンテキスト分離**: ✅ 成功 / ❌ 失敗
- **成果物品質**: XX% (目標: 100%)

## 詳細ログ

### Phase 1: 戦略策定

[実行ログ]

**成果物**: /Users/ksato/workspace/_codex/projects/test-project/01_strategy.md

**品質チェック**:
- [ ] プロダクト概要: 30〜60文字
- [ ] ICP定義: 業界・企業規模・役職含む
- [ ] 約束する価値: 定量成果含む
- [ ] 主要KPI: 3〜5個、目標値付き

### Phase 2: RACI定義

[実行ログ]

**成果物**: /Users/ksato/workspace/_codex/common/meta/raci/unson.md

**品質チェック**:
- [ ] Accountable: 各領域で1人のみ
- [ ] 立ち位置: 資産・権利の範囲明確
- [ ] 決裁ライン: 明確
- [ ] 管轄プロダクト: test-project含む

## 観察事項

### 期待通りだった点
- [...]

### 想定外だった点
- [...]

### 発見事項
- [...]

## 次のアクション

- [ ] [アクション1]
- [ ] [アクション2]

## 代替案（失敗時のみ）

[代替実装方法]
```

---

## 参考情報

### test-orchestrator検証結果

- **重要**: `{skill}/agents/`構造が動作することを確認（2025-12-26 再検証）
- `.claude/agents/`へのコピーは不要
- セッション再起動が必須
- 効率改善: 約10倍

詳細: `/Users/ksato/workspace/_codex/projects/brainbase/test_orchestrator_verification_final.md`

### 関連ドキュメント

- 設計書: `_codex/projects/brainbase/90day_checklist_orchestrator_design.md`
- Skills概念: `_codex/projects/brainbase/skills_concept.md`
- Skillsシミュレーション: `_codex/projects/brainbase/skills_simulation.md`

---

最終更新: 2025-12-26
M5.2 Phase 2実装: 90day-checklist Orchestrator
