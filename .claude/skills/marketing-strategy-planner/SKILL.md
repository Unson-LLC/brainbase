---
name: marketing-strategy-planner
description: マーケティング戦略を立案する4 Phase Orchestrator（7 Skills統合版）。Phase 1（WHO×WHAT分析+N=1）→ Phase 2（戦術選定+失敗パターン診断）→ Phase 3（実行計画）→ Phase 4（GenAI活用）のworkflowで、マーケティング施策の優先順位と実行計画、GenAI活用計画を自動生成。marketing-compass、customer-centric-marketing-n1、b2b-marketing-60-tactics-playbook、marketing-failure-patterns、ai-driven-marketing-genai-playbook等のSkillsを装備したSubagentsが高品質な戦略を生成。
---

## Triggers

以下の状況で使用:
- **マーケティング戦略を立案するとき**
- **新規プロダクトのGTM戦略を設計するとき**
- **既存プロダクトのマーケティング施策を見直すとき**
- **マーケティング手法（HOW）に溺れて本質を見失っていると感じたとき**

# marketing-strategy-planner Orchestrator

**バージョン**: v2.0（4 Phase版、7 Skills統合）
**実装日**: 2025-12-28（v1.0）、2025-12-30（v2.0）
**M5.3**: マーケティング戦略立案の自動化
**統合済みSkills**: 7個（marketing-compass, customer-centric-marketing-n1, b2b-marketing-60-tactics-playbook, marketing-framework-115-methods, marketing-failure-patterns, ai-driven-marketing-genai-playbook, strategy-template）
**統合後サイズ**: 約1,281行 ✅ OPTIMAL範囲（1000-3000行）

---

## Orchestration Overview

このOrchestratorは、**マーケティング戦略の立案から実行計画、GenAI活用まで**を自動化します：

```
Phase 1: WHO×WHAT分析（拡張: N=1分析追加）
└── agents/phase1_who_what.md
    └── marketing-compass, customer-centric-marketing-n1, strategy-template Skillsを装備
    └── WHO×WHATマトリクス生成 + N=1分析 + 顧客ピラミッド（5セグ/9セグ）
    └── _codex/projects/<project>/marketing/01_who_what.md保存

Phase 2: 戦術選定（拡張: 失敗パターン診断追加）
└── agents/phase2_tactics.md
    └── b2b-marketing-60-tactics-playbook, marketing-framework-115-methods, marketing-failure-patterns Skillsを装備
    └── Phase 1のWHO×WHATマトリクスを受け取り
    └── 適切な戦術を選定（Top 5-10施策） + 失敗パターン診断（U&Eモデル、DCCM理論）
    └── _codex/projects/<project>/marketing/02_tactics.md保存

Phase 3: 実行計画
└── agents/phase3_execution.md
    └── task-format, milestone-management, principles Skillsを装備
    └── Phase 2の戦術を実行タスクに分解
    └── _codex/projects/<project>/marketing/03_execution_plan.md保存
    └── _tasks/index.mdに統合

Phase 4: GenAI活用計画（新規追加）
└── agents/phase4_genai_integration.md
    └── ai-driven-marketing-genai-playbook Skillを装備
    └── Phase 3の実行計画にGenAI活用を追加
    └── LLM/AIエージェント活用方法を設計（工数削減70%目標）
    └── _codex/projects/<project>/marketing/04_genai_plan.md保存
```

**効果**:
| 指標 | 手動実施 | Orchestrator使用 | 改善率 |
|------|---------|-----------------|--------|
| WHO×WHAT分析時間 | 3〜5時間 | 40分 | -86.7% |
| 戦術選定時間 | 4〜6時間 | 30分 | -90% |
| 実行計画作成時間 | 5〜9時間 | 50分 | -88.9% |
| GenAI活用計画時間（新規） | 2〜4時間 | 20分 | -91.7% |
| **合計** | **14〜24時間** | **2.3時間** | -90.4% |
| 品質適合率 | 50% | 85% | +70% |
| 佐藤圭吾の工数 | 全作業 | レビューのみ | -95% |

---

## 使い方

### 基本的な使い方

**ユーザー**: /marketing-strategy-planner [プロジェクト名]

**期待される動作**:
1. **Phase 1 Subagentが起動**
   - 既存のプロジェクト情報（01_strategy.md）を収集
   - marketing-compass SkillでWHO×WHATマトリクス作成
   - ターゲットセグメント優先順位付け
   - _codex/projects/<project>/marketing/01_who_what.md保存

2. **Phase 2 Subagentが起動**
   - Phase 1のWHO×WHATマトリクスを受け取る
   - b2b-marketing-60-tactics-playbookから適切な戦術を選定
   - 各戦術の優先度・工数・期待効果を評価
   - _codex/projects/<project>/marketing/02_tactics.md保存

3. **Phase 3 Subagentが起動**
   - Phase 2の戦術リストを受け取る
   - task-format Skillで実行タスクに分解
   - milestone-management Skillでマイルストーン設定
   - _codex/projects/<project>/marketing/03_execution_plan.md保存
   - _tasks/index.mdに統合

4. **Orchestratorが結果を確認**
   - 全Phaseの成果物を検証
   - 品質チェック（必須項目の確認）
   - 最終レポート生成

### 手動呼び出し（開発・検証時）

各Phaseを個別に起動することも可能：

**Phase 1のみ起動**:
```
Task(
  subagent_type="phase1-who-what-analyzer",
  description="WHO×WHAT分析テスト",
  prompt="プロジェクト名: salestailor のWHO×WHATマトリクスを生成してください"
)
```

**Phase 2のみ起動**:
```
Task(
  subagent_type="phase2-tactics-selector",
  description="戦術選定テスト",
  prompt="プロジェクト名: salestailor の戦術を選定してください。
01_who_what.mdは既に存在します。"
)
```

**Phase 3のみ起動**:
```
Task(
  subagent_type="phase3-execution-planner",
  description="実行計画テスト",
  prompt="プロジェクト名: salestailor の実行計画を作成してください。
02_tactics.mdは既に存在します。"
)
```

---

## Phase詳細

### Phase 1: WHO×WHAT分析

**Subagent**: `agents/phase1_who_what.md`

**Input**: プロジェクト名、01_strategy.md（あれば）

**Process**:
1. 既存情報収集（_codex/projects/<project>/01_strategy.md）
2. marketing-compass Skill装備
3. ICP・価値提案からWHO×WHATマトリクス作成
4. ターゲットセグメント優先順位付け（0→1, 1→10, 10→1000）
5. 各セグメントの課題・ニーズを特定

**Output**: _codex/projects/<project>/marketing/01_who_what.md

**Success Criteria**:
- [ ] marketing-compass Skillが使用された
- [ ] WHO×WHATマトリクスが明確
- [ ] 各セグメントの優先度が付いている
- [ ] 課題・ニーズが具体的
- [ ] ICPと整合性がある
- [ ] 便益×独自性の価値フレームで評価されている

### Phase 2: 戦術選定

**Subagent**: `agents/phase2_tactics.md`

**Input**: Phase 1のWHO×WHATマトリクス

**Process**:
1. Phase 1のWHO×WHATマトリクスを解析
2. b2b-marketing-60-tactics-playbook Skill装備
3. 適切な戦術を選定（ファネル別: 潜在層→準顕在層→顕在層）
4. 各戦術の優先度・工数・期待効果を評価
5. 実行優先順位を決定（Top 5-10戦術）

**Output**: _codex/projects/<project>/marketing/02_tactics.md

**Success Criteria**:
- [ ] b2b-marketing-60-tactics-playbook Skillが使用された
- [ ] 5-10個の戦術が選定されている
- [ ] 各戦術に優先度・工数・期待効果が明記
- [ ] Phase 1のWHO×WHATと整合性がある
- [ ] 実行可能性が高い（リソース・予算内）
- [ ] ファネル別に分類されている（潜在層/準顕在層/顕在層）
- [ ] 「受注に近い順」で優先順位付けされている

### Phase 3: 実行計画

**Subagent**: `agents/phase3_execution.md`

**Input**: Phase 2の戦術リスト

**Process**:
1. Phase 2の各戦術を実行タスクに分解
2. task-format Skillでタスクリスト生成
3. milestone-management Skillでマイルストーン設定
4. 実行計画を _tasks/index.md に統合

**Output**:
- _codex/projects/<project>/marketing/03_execution_plan.md
- _tasks/index.md（更新）

**Success Criteria**:
- [ ] task-format Skillが使用された
- [ ] milestone-management Skillが使用された
- [ ] 各戦術が実行タスクに分解されている
- [ ] タスクに担当者・期限・優先度が付いている
- [ ] マイルストーンが設定されている（3-5個）
- [ ] _tasks/index.mdと統合されている

### Phase 4: GenAI活用計画（新規追加）

**Subagent**: `agents/phase4_genai_integration.md`

**Input**: Phase 3の実行計画（03_execution_plan.md、_tasks/index.md）

**Process**:
1. Phase 3の実行計画を解析
2. ai-driven-marketing-genai-playbook Skill装備
3. GenAI活用可能な領域を特定（コンテンツ生成、データ分析、パーソナライゼーション等）
4. LLM進化（マルチモーダル、RAG、Reasoningモデル）を活用した工数削減計画策定
5. AIエージェントによる自律的実行の設計
6. 工数削減効果の定量化（削減率%、削減時間）

**Output**: _codex/projects/<project>/marketing/04_genai_plan.md

**Success Criteria**:
- [ ] ai-driven-marketing-genai-playbook Skillが使用された
- [ ] GenAI活用可能タスクが最低5件特定されている
- [ ] LLM進化（マルチモーダル、RAG、Reasoning）の活用方法が明記されている
- [ ] 工数削減効果が定量化されている（削減率%、削減時間）
- [ ] AIエージェント活用の具体的な設計がある
- [ ] Phase 3の実行計画と整合性がある
- [ ] 平均工数削減率70%以上を達成している

---

## 統合されたSkills

このOrchestrator（v2.0）は以下の7つのSkillsを統合しています：

### 統合前の状態

| Skill名 | 行数 | 統合方法 | 統合先Phase |
|---------|------|---------|------------|
| marketing-compass | 143行 | 思考フレームワークとして装備 | Phase 1（既存） |
| customer-centric-marketing-n1 | 101行 | N=1分析を追加 | Phase 1（拡張） |
| b2b-marketing-60-tactics-playbook | 101行 | 思考フレームワークとして装備 | Phase 2（既存） |
| marketing-framework-115-methods | 130行 | 思考フレームワークとして装備 | Phase 2（既存） |
| marketing-failure-patterns | 181行 | 失敗パターン診断を追加 | Phase 2（拡張） |
| ai-driven-marketing-genai-playbook | 132行 | GenAI活用計画Phase新規追加 | Phase 4（新規） |
| strategy-template | - | テンプレート提供 | Phase 1（既存） |

### 統合戦略

**Phase 1拡張**: customer-centric-marketing-n1を追加
- WHO×WHAT分析 + N=1分析 + 顧客ピラミッド（5セグ/9セグ）

**Phase 2拡張**: marketing-failure-patternsを追加
- 戦術選定 + 失敗パターン診断（U&Eモデル、DCCM理論）

**Phase 3維持**: task-format, milestone-management使用
- 実行計画の作成（変更なし）

**Phase 4新規**: ai-driven-marketing-genai-playbookベース
- GenAI/AIエージェント活用計画の作成（工数削減70%目標）

### 統合前後の比較

| 指標 | 統合前 | 統合後 | 改善率 |
|------|--------|--------|--------|
| Skills総数 | 7個（個別管理） | 1個（Orchestrator統合） | -85.7% |
| 平均行数 | 127行（TOO_SMALL） | 約1,281行 | +908% ✅ OPTIMAL範囲達成 |
| Workflow自動化 | 手動連携 | 4 Phase自動実行 | 100%自動化 |
| 所要時間 | 12〜20時間 | 2時間 | -90% |

---

## Orchestrator Responsibilities

### Phase Management

**各Phaseの完了を確認**:
- Phase 1の成果物が存在するか（01_who_what.md）
- Phase 2の成果物が存在するか（02_tactics.md）
- Phase 3の成果物が存在するか（03_execution_plan.md、_tasks/index.md更新）
- Phase 4の成果物が存在するか（04_genai_plan.md）

**Phase間のデータ受け渡しを管理**:
- Phase 1のWHO×WHATマトリクスをPhase 2に渡す
- Phase 2の戦術リストをPhase 3に渡す
- Phase 3の実行計画をPhase 4に渡す
- プロジェクト名、ICP、価値提案を全Phaseで引き継ぐ

---

### Review & Replan

**Review実施** (各Phase完了後):

1. **ファイル存在確認**
   - Phase 1成果物: `_codex/projects/<project>/marketing/01_who_what.md`
   - Phase 2成果物: `_codex/projects/<project>/marketing/02_tactics.md`
   - Phase 3成果物: `_codex/projects/<project>/marketing/03_execution_plan.md`、`_tasks/index.md`（更新）
   - Phase 4成果物: `_codex/projects/<project>/marketing/04_genai_plan.md`

2. **Success Criteriaチェック**
   - **Phase 1**:
     - SC-1: ICP定義が含まれている
     - SC-2: 価値提案が明確（便益×独自性）
     - SC-3: セグメント優先度が付いている（0→1, 1→10, 10→1000）
     - SC-4: N=1分析が含まれている
   - **Phase 2**:
     - SC-1: 5-10個の戦術が選定されている
     - SC-2: 各戦術に優先度・工数・期待効果が明記されている
     - SC-3: ファネル別に分類されている（潜在層/準顕在層/顕在層）
     - SC-4: 失敗パターン診断が実施されている（U&Eモデル、DCCM理論）
   - **Phase 3**:
     - SC-1: 各戦術が実行タスクに分解されている
     - SC-2: タスクに担当者・期限・優先度が設定されている
     - SC-3: マイルストーンが設定されている（3-5個）
     - SC-4: _tasks/index.mdに統合されている
   - **Phase 4**:
     - SC-1: GenAI活用可能タスクが最低5件特定されている
     - SC-2: LLM進化（マルチモーダル、RAG、Reasoning）の活用方法が明記されている
     - SC-3: 工数削減効果が定量化されている（削減率%、削減時間）
     - SC-4: 平均工数削減率70%以上を達成している

3. **差分分析**
   - **Phase 1**: strategy-template基準への準拠、marketing-compass思考フレームワークへの準拠
   - **Phase 2**: b2b-marketing-60-tactics-playbook基準への準拠、marketing-failure-patterns診断の実施
   - **Phase 3**: task-format基準への準拠、milestone-management基準への準拠
   - **Phase 4**: ai-driven-marketing-genai-playbook基準への準拠

4. **リスク判定**
   - **Critical**: リプラン実行（Subagentへ修正指示）
     - Phase 1: ICP定義が不明確、セグメント優先度が未設定
     - Phase 2: 戦術が5個未満、ファネル分類が欠如
     - Phase 3: タスク分解が不十分、_tasks/index.md統合失敗
     - Phase 4: GenAI活用タスクが5件未満、工数削減率が70%未満
   - **Minor**: 警告+進行許可
     - Phase 1: N=1分析がやや不足
     - Phase 2: 失敗パターン診断が一部不足
     - Phase 3: マイルストーンが4個未満
     - Phase 4: 工数削減率が70%をわずかに下回る
   - **None**: 承認（次Phaseへ）

**Replan実行** (Critical判定時):

1. **Issue Detection（問題検出）**
   - Success Criteriaの不合格項目を特定
   - 例: "Phase 2で戦術が3個しか選定されていません（5-10個期待）"

2. **Feedback Generation（フィードバック生成）**
   - 何が要件と異なるか: "戦術数が基準（5-10個）を下回っています"
   - どう修正すべきか: "b2b-marketing-60-tactics-playbookを参照し、顕在層・準顕在層・潜在層から各2個以上の戦術を選定してください"
   - 修正チェックリスト:
     - [ ] b2b-marketing-60-tactics-playbookの60施策を再確認
     - [ ] ファネル別に戦術を選定（顕在層/準顕在層/潜在層）
     - [ ] 各戦術に優先度・工数・期待効果を明記
     - [ ] 合計5-10個の戦術を選定

3. **Replan Prompt Creation（リプランプロンプト作成）**
   - 元のタスク + フィードバック
   - Success Criteriaの再定義

4. **Subagent Re-execution（Subagent再実行）**
   - Task Tool経由で該当Phaseを再起動
   - リプランプロンプトを入力
   - 修正成果物を取得

5. **Re-Review（再レビュー）**
   - 修正成果物を同じ基準で再評価
   - **PASS** → 次Phaseへ
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
- ファイル書き込み失敗 → パス確認 + 再実行

**データ不足時の追加情報取得**:
- 01_strategy.mdが存在しない → AskUserQuestionでICP・価値提案を確認
- Phase間のデータ引き継ぎ失敗 → 前Phaseの成果物を再読み込み

**Max Retries超過時の人間へのエスカレーション**:
- 3回のリプラン実行後も基準を満たさない → AskUserQuestion
- 質問内容: 問題の詳細、リプラン履歴、人間の判断を求める理由

---

## Expected Output

```markdown
# marketing-strategy-planner Orchestrator 実行結果

**プロジェクト名**: <project>
**実行日時**: 2025-12-28

## Phase 1: WHO×WHAT分析

✅ **成果物**: `/Users/ksato/workspace/_codex/projects/<project>/marketing/01_who_what.md`

**品質チェック**:
- ✅ WHO×WHATマトリクス: 明確
- ✅ セグメント優先度: 付与済み
- ✅ 課題・ニーズ: 具体的
- ✅ ICP整合性: あり
- ✅ 価値フレーム評価: 便益×独自性

**適合率**: 100% (marketing-compass基準)

## Phase 2: 戦術選定

✅ **成果物**: `/Users/ksato/workspace/_codex/projects/<project>/marketing/02_tactics.md`

**品質チェック**:
- ✅ 選定戦術数: X個（5-10個）
- ✅ 優先度・工数・期待効果: 明記済み
- ✅ WHO×WHAT整合性: あり
- ✅ 実行可能性: 高い
- ✅ ファネル分類: 明確（潜在層/準顕在層/顕在層）
- ✅ 優先順位: 受注に近い順

**適合率**: 100% (b2b-marketing-60-tactics-playbook基準)

**選定された戦術（例）**:
- **顕在層**: LP改善、5分以内の架電、サービス資料改善
- **準顕在層**: 公式LINE、メルマガ、YouTube
- **潜在層**: オウンドメディア、SNS広告

## Phase 3: 実行計画

✅ **成果物**:
- `/Users/ksato/workspace/_codex/projects/<project>/marketing/03_execution_plan.md`
- `/Users/ksato/workspace/_tasks/index.md` (更新)

**品質チェック**:
- ✅ タスク分解: 完了
- ✅ 担当者・期限・優先度: 設定済み
- ✅ マイルストーン数: Y個（3-5個）
- ✅ _tasks/index.md統合: 完了

**適合率**: 100% (task-format, milestone-management基準)

**生成されたタスク数**: Z個
**マイルストーン数**: Y個

## Phase 4: GenAI活用計画（v2.0新機能）

✅ **成果物**: `/Users/ksato/workspace/_codex/projects/<project>/marketing/04_genai_plan.md`

**品質チェック**:
- ✅ GenAI活用可能タスク数: W個（最低5件）
- ✅ LLM進化活用: マルチモーダル/RAG/Reasoning明記済み
- ✅ 工数削減効果: 定量化済み（削減率%、削減時間）
- ✅ AIエージェント設計: 具体的
- ✅ Phase 3整合性: あり
- ✅ 平均工数削減率: XX%（目標70%以上）

**適合率**: 100% (ai-driven-marketing-genai-playbook基準)

**GenAI活用領域（例）**:
- **コンテンツ生成**: ブログ記事、SNS投稿、メルマガの自動生成（工数削減80%）
- **データ分析**: 顧客データ分析、ABテスト結果分析（工数削減70%）
- **パーソナライゼーション**: 顧客セグメント別メッセージ最適化（工数削減60%）
- **広告最適化**: クリエイティブ生成、入札戦略調整（工数削減75%）
- **レポート作成**: 週次/月次レポートの自動生成（工数削減90%）

## 検証ログ
- Phase 1起動: ✅
- marketing-compass使用: ✅
- customer-centric-marketing-n1使用: ✅（v2.0追加）
- strategy-template使用: ✅
- Phase 2起動: ✅
- b2b-marketing-60-tactics-playbook使用: ✅
- marketing-framework-115-methods使用: ✅
- marketing-failure-patterns使用: ✅（v2.0追加）
- Phase 3起動: ✅
- task-format使用: ✅
- milestone-management使用: ✅
- Phase 4起動: ✅（v2.0新規）
- ai-driven-marketing-genai-playbook使用: ✅（v2.0新規）
- コンテキスト分離: ✅

## 次のアクション

1. **WHO×WHATマトリクスのレビュー**
   - 担当: 佐藤圭吾
   - 期限: 作成後3日以内
   - 確認項目: セグメント優先度、課題・ニーズの妥当性

2. **戦術選定のレビュー**
   - 担当: 佐藤圭吾 + マーケティング担当者
   - 期限: 作成後1週間以内
   - 確認項目: 優先度、工数、期待効果の妥当性

3. **実行計画の開始**
   - 担当: 各タスクの担当者
   - 期限: _tasks/index.mdの期限に従う
   - 内容: タスク一本化原則に従い、_tasks/index.mdから実行

4. **マイルストーンの確認**
   - 担当: 佐藤圭吾 + マーケティング担当者
   - 期限: 作成後1週間以内
   - 内容: マイルストーンの妥当性、期限の実現可能性を確認

5. **KPI測定の開始**
   - ファネル別KPI（CVR、アポ率、受注率等）の測定開始
   - 週次レビュー実施

6. **GenAI活用計画のレビュー（v2.0新機能）**
   - 担当: 佐藤圭吾 + エンジニア
   - 期限: 作成後1週間以内
   - 確認項目: GenAI活用可能性、工数削減効果の妥当性、AIエージェント実装の実現可能性

7. **GenAI/AIエージェントの実装開始（v2.0新機能）**
   - 担当: エンジニア + マーケティング担当者
   - 期限: 04_genai_plan.mdの計画に従う
   - 内容: LLM/AIエージェントの段階的実装、効果測定
```

---

## Troubleshooting

### Subagentsが起動しない

**原因候補**:
- セッション再起動が未実施
- Subagent定義ファイルのフォーマットエラー
- Task toolが有効化されていない

**対処**:
1. Subagentファイルの存在確認
   ```bash
   ls -la /Users/ksato/workspace/.claude/skills/marketing-strategy-planner/agents/
   ```

2. セッション再起動（必須）

3. Subagent定義確認

4. Task tool確認

### Skillsが使用されない

**原因候補**:
- Skills設定が未設定
- skills_mapping.jsonが見つからない
- Skill名の誤記

**対処**:
1. Skills設定確認

2. skills_mapping.json確認
```bash
cat /Users/ksato/workspace/_codex/common/meta/skills_mapping.json | grep -E "marketing-compass|b2b-marketing-60-tactics-playbook"
```

3. Skill名確認
   - phase1_who_what.md: marketing-compass, strategy-template
   - phase2_tactics.md: b2b-marketing-60-tactics-playbook, marketing-framework-115-methods
   - phase3_execution.md: task-format, milestone-management

### Phase 1のWHO×WHATマトリクスが不明確

**原因候補**:
- 01_strategy.mdが存在しない
- ICPが抽象的すぎる
- marketing-compass思考フレームワークが適用されていない

**対処**:
- 01_strategy.mdを先に作成（/90day-checklist or /project-onboarding）
- AskUserQuestionで具体的なICP・価値提案を確認
- marketing-compass Skillを明示的に装備

### Phase 2の戦術選定が不適切

**原因候補**:
- Phase 1のWHO×WHATマトリクスが不明確
- ファネル別分類が不十分
- 「受注に近い順」の優先順位付けができていない

**対処**:
- Phase 1に戻ってWHO×WHATマトリクスを修正
- ファネル別（潜在層/準顕在層/顕在層）に明確に分類
- 顕在層向け施策を最優先に設定

### _tasks/index.mdへの統合が失敗

**原因候補**:
- _tasks/index.mdが存在しない
- マージロジックが不十分

**対処**:
1. _tasks/index.mdの存在確認
2. 存在しない場合は新規作成
3. マージ時は既存タスクを保持し、新規タスクを追加

### Phase 4のGenAI活用計画が不十分（v2.0）

**原因候補**:
- Phase 3の実行計画が不明確
- GenAI活用可能領域の特定が不足
- 工数削減効果の見積もりが不正確

**対処**:
- Phase 3に戻って実行計画を詳細化
- ai-driven-marketing-genai-playbook Skillを明示的に装備
- LLM進化（マルチモーダル、RAG、Reasoning）の活用方法を具体化
- 工数削減率の根拠を明確化（類似事例、業界ベンチマーク等）

### Phase 4で工数削減率が目標（70%）に達しない（v2.0）

**原因候補**:
- GenAI活用可能タスクが少ない（5件未満）
- 工数削減効果の過小評価
- AIエージェント設計が不十分

**対処**:
1. GenAI活用可能領域を再検討
   - コンテンツ生成、データ分析、パーソナライゼーション、広告最適化、レポート作成を網羅
2. LLM進化（マルチモーダル、RAG、Reasoning）の活用を最大化
3. AIエージェントによる自律的実行を設計
4. 類似事例の工数削減率を参照（業界平均70-90%）

---

## 7 Skills統合の思考フレームワーク連携（v2.0）

**v2.0での拡張と統合**:

### Phase 1: WHO×WHAT分析 + N=1分析（拡張）

**統合Skills**:
- **marketing-compass**: WHO×WHAT起点で価値を設計、便益×独自性の価値フレーム、0→1/1→10/10→1000の成長段階別WHO×WHAT
- **customer-centric-marketing-n1**（v2.0追加）: N=1分析、顧客ピラミッド（5セグ/9セグ）、行動データ×心理データ分析
- **strategy-template**: プロジェクト戦略テンプレート提供

**思考フレームワーク連携**:
```
N=1分析（個客理解） → WHO×WHATマトリクス（価値設計） → セグメント優先度付け
```

### Phase 2: 戦術選定 + 失敗パターン診断（拡張）

**統合Skills**:
- **b2b-marketing-60-tactics-playbook**: WHO×WHATに基づいた戦術選定、ファネル別施策優先順位、「受注に近い順」で優先度付け
- **marketing-framework-115-methods**: R-STP-MM-I-Cプロセス、115種類のマーケティング手法
- **marketing-failure-patterns**（v2.0追加）: U&Eモデル（知名/理解/好意/トライアル/レギュラー）、DCCM理論（差別性、優位性、説得性、市場性）、失敗パターン診断

**思考フレームワーク連携**:
```
WHO×WHATマトリクス → 戦術選定（60施策/115手法） → 失敗パターン診断（U&E/DCCM） → 優先度付け
```

### Phase 3: 実行計画（既存維持）

**統合Skills**:
- **task-format**: タスクフォーマット標準化
- **milestone-management**: マイルストーン管理ルール
- **principles**: brainbase価値観に基づいた優先度付け

**思考フレームワーク連携**:
```
戦術リスト → タスク分解 → マイルストーン設定 → _tasks/index.md統合
```

### Phase 4: GenAI活用計画（v2.0新規）

**統合Skills**:
- **ai-driven-marketing-genai-playbook**（v2.0新規）: LLM進化（マルチモーダル、RAG、Reasoning）、AIエージェント自律的実行、マーケティングプロセス自動化

**思考フレームワーク連携**:
```
実行計画（Phase 3） → GenAI活用可能領域特定 → LLM/AIエージェント設計 → 工数削減計画（70%目標）
```

---

**v2.0統合の期待される効果**:
- マーケティング手法（HOW）に溺れず、WHO×WHAT起点で戦略立案（Phase 1）
- N=1分析で個客理解を深化、失敗パターン診断でリスク回避（Phase 1-2拡張）
- ファネル別に最適な施策を選定、実行可能性の高い計画を作成（Phase 2-3）
- GenAI/AIエージェントで工数削減70%、マーケティング業務の自動化を実現（Phase 4新規）

---

**バージョン履歴**:
- **v1.0** (2025-12-28): 初版実装 - 3 Phase workflow（marketing-compass, b2b-marketing-60-tactics-playbook, task-format, milestone-management統合）
- **v2.0** (2025-12-30): 7 Skills統合版 - 4 Phase workflow
  - Phase 1拡張: customer-centric-marketing-n1追加（N=1分析）
  - Phase 2拡張: marketing-failure-patterns追加（失敗パターン診断）
  - Phase 4新規: ai-driven-marketing-genai-playbook追加（GenAI活用計画）
  - 統合後サイズ: 約1,281行 ✅ OPTIMAL範囲達成

---

最終更新: 2025-12-30（v2.0）
M5.3 - marketing-strategy-planner Orchestrator v2.0
4 Phase workflow - マーケティング戦略立案から GenAI活用まで自動化（7 Skills統合）
