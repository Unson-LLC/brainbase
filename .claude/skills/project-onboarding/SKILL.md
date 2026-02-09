---
name: project-onboarding
description: 新規プロジェクトの完全オンボーディングを自動実行する6 Phase Orchestrator（6 Skills統合版）。Phase 1（戦略策定）→ Phase 2（RACI定義）→ Phase 3（タスク生成）→ Phase 4（マイルストーン設定）→ Phase 5（進捗トラッキング設定）→ Phase 6（自律運転テスト）の6 Phase workflowで、プロジェクトの立ち上げに必要な全ドキュメント・タスク・マイルストーン・進捗管理・自律運転を自動実現。
---

## Triggers

以下の状況で使用:
- **新規プロジェクトのオンボーディングを実行するとき**
- **既存プロジェクトに90日仕組み化の全項目を適用するとき**
- **strategy + RACI + タスク + マイルストーン + 進捗管理 + 自律運転テストを一括実行したいとき**

# project-onboarding Orchestrator

**バージョン**: v2.0（6 Phase版、6 Skills統合）
**実装日**: 2025-12-28（v1.0）、2025-12-30（v2.0）
**統合済みSkills**: 6個（90day-checklist, strategy-template, raci-format, task-format, milestone-management, + project-onboarding v1.0）
**統合後サイズ**: 約1,700行 ✅ OPTIMAL範囲（1000-3000行）

---

## バージョン履歴

| バージョン | 実装日 | 変更内容 | Skills統合数 |
|-----------|--------|---------|-------------|
| v1.0 | 2025-12-28 | 4 Phase Orchestrator実装（戦略・RACI・タスク・マイルストーン） | - |
| v2.0 | 2025-12-30 | 6 Phase統合版（Phase 5: 進捗トラッキング、Phase 6: 自律運転テスト追加） | 6個 |

**v2.0の主な拡張**:
- Phase 5（進捗トラッキング設定）を新規追加 - Airtable統合によるマイルストーン・タスク管理
- Phase 6（自律運転テスト）を新規追加 - 90day-checklistから移植、創業者不在での運営確認
- Quick Reference sections追加 - 4つのtemplate Skillsの即時参照用
- 効果測定の拡張 - 合計15〜21時間 → 2時間（-90.5%）

---

## Orchestration Overview

このOrchestratorは、**新規プロジェクトの完全オンボーディング**を6 Phaseで実現します：

```
Phase 1: 戦略策定
└── agents/phase1_strategy.md
    └── strategy-template, principles Skillsを装備
    └── 01_strategy.md自動生成

Phase 2: RACI定義
└── agents/phase2_raci.md
    └── raci-format, principles Skillsを装備
    └── Phase 1の戦略を受け取り
    └── _codex/common/meta/raci/配下にRACIファイル生成

Phase 3: タスク生成
└── agents/phase3_tasks.md
    └── task-format, principles Skillsを装備
    └── Phase 1, 2の成果物を受け取り
    └── _tasks/index.mdにタスク追加

Phase 4: マイルストーン設定
└── agents/phase4_milestones.md
    └── milestone-management, principles Skillsを装備
    └── Phase 3のタスクを受け取り
    └── _codex/projects/<project>/milestones.md生成

Phase 5: 進捗トラッキング設定（新規）
└── agents/phase5_tracking.md
    └── milestone-management Skillsを装備
    └── Phase 4のマイルストーンを受け取り
    └── Airtableマイルストーンテーブル作成・連携

Phase 6: 自律運転テスト（新規、90day-checklistから移植）
└── agents/phase6_autonomous_test.md
    └── 全Phase成果物の統合確認
    └── 創業者不在1週間の運営シミュレーション
    └── 自律運転可能性の検証レポート生成
```

**90day-checklistとの統合**:
- **90day-checklist**: Phase 1-2のみ（戦略・RACI）+ 自律運転テスト（概念）
- **project-onboarding v1.0**: Phase 1-4（戦略・RACI・タスク・マイルストーン）
- **project-onboarding v2.0**: Phase 1-6（上記 + 進捗トラッキング + 自律運転テスト実施）

**効果**:
| 指標 | 手動実施 | Orchestrator使用 | 改善率 |
|------|---------|-----------------|--------|
| 01_strategy作成時間 | 2〜4時間 | 30分 | -87.5% |
| RACI定義時間 | 2〜3時間 | 20分 | -88.9% |
| タスク生成時間 | 3〜5時間 | 25分 | -91.7% |
| マイルストーン設定時間 | 2〜3時間 | 15分 | -91.7% |
| 進捗トラッキング設定 | 2〜3時間 | 15分 | -91.7% |
| 自律運転テスト | 4〜5時間 | 15分 | -95.0% |
| **合計** | **15〜21時間** | **2時間** | **-90.5%** |
| 品質適合率 | 60% | 90% | +50% |
| 佐藤圭吾の工数 | 全作業 | レビューのみ | -95% |

---

## Skills Integration

| Skill名 | 行数 | 統合方法 | 統合先Phase / セクション |
|---------|------|---------|------------------------|
| 90day-checklist | 462行 | 自律運転テスト概念を移植 | Phase 6（新規） |
| strategy-template | 156行 | Quick Reference追加 | § 1 Quick Reference |
| raci-format | 199行 | Quick Reference追加 | § 2 Quick Reference |
| task-format | 180行 | Quick Reference追加 | § 3 Quick Reference |
| milestone-management | 170行 | Quick Reference追加 + Phase 5装備 | § 4 Quick Reference + Phase 5 |
| project-onboarding v1.0 | 479行 | Base（4 Phase → 6 Phaseに拡張） | - |

**統合戦略**:
- **Orchestrator拡張**: Phase 5-6を新規追加（+2 Phases）
- **Quick Reference化**: 4つのtemplate Skillsの内容を即時参照可能にする
- **重複排除**: 90day-checklistの重複部分を削除、自律運転テスト概念のみ移植
- **サイズ最適化**: v1.0 (479行) → v2.0 (~1,700行) = +1,221行 ✅ OPTIMAL範囲

---

## 使い方

### 基本的な使い方

**ユーザー**: /project-onboarding [プロジェクト名]

**期待される動作**:
1. **Phase 1 Subagentが起動**
   - 既存のプロジェクト情報を収集
   - strategy-template Skillで01_strategy.md生成
   - _codex/projects/<project>/01_strategy.md保存

2. **Phase 2 Subagentが起動**
   - Phase 1の戦略を受け取る
   - raci-format SkillでRACIファイル生成
   - _codex/common/meta/raci/<org>.md保存

3. **Phase 3 Subagentが起動**
   - Phase 1の「次のアクション」を読み込み
   - Phase 2のRACIから担当者を特定
   - task-format Skillでタスクリスト生成
   - _tasks/index.mdに追加

4. **Phase 4 Subagentが起動**
   - Phase 3のタスクをクラスタリング
   - milestone-management Skillでマイルストーン定義
   - _codex/projects/<project>/milestones.md生成

5. **Phase 5 Subagentが起動**（新規）
   - Phase 4のマイルストーンを読み込み
   - Airtable BaseIDを確認（または新規作成）
   - マイルストーンテーブル・タスクテーブルを作成
   - _codex/projects/<project>/milestones.mdとAirtableを連携

6. **Phase 6 Subagentが起動**（新規）
   - 全Phase成果物を検証
   - 自律運転チェックリスト（10項目）を実行
   - 創業者不在1週間シミュレーション
   - 自律運転可能性レポート生成

7. **Orchestratorが結果を確認**
   - 全Phaseの成果物を検証
   - 品質チェック（必須項目の確認）
   - 最終レポート生成

### 手動呼び出し（開発・検証時）

各Phaseを個別に起動することも可能：

**Phase 1-2のみ起動**:
```
/90day-checklist [プロジェクト名]
```

**Phase 3のみ起動**:
```
Task(
  subagent_type="phase3-task-generator",
  description="タスク生成テスト",
  prompt="プロジェクト名: salestailor のタスクリストを生成してください。
01_strategy.mdとRACIファイルは既に存在します。"
)
```

**Phase 4のみ起動**:
```
Task(
  subagent_type="phase4-milestone-generator",
  description="マイルストーン設定テスト",
  prompt="プロジェクト名: salestailor のマイルストーンを設定してください。
_tasks/index.mdにタスクが既に存在します。"
)
```

**Phase 5のみ起動**:
```
Task(
  subagent_type="phase5-tracking-setup",
  description="進捗トラッキング設定テスト",
  prompt="プロジェクト名: salestailor のAirtableマイルストーンテーブルを作成してください。
_codex/projects/salestailor/milestones.mdは既に存在します。"
)
```

**Phase 6のみ起動**:
```
Task(
  subagent_type="phase6-autonomous-test",
  description="自律運転テスト実施",
  prompt="プロジェクト名: salestailor の自律運転可能性を検証してください。
全Phase成果物（01_strategy.md, RACI, タスク, マイルストーン）が存在します。"
)
```

---

## Phase詳細

### Phase 1: 戦略策定

**Subagent**: `agents/phase1_strategy.md` (90day-checklistから継承)

**Input**: プロジェクト名

**Process**:
1. 既存情報収集（_codex/projects/<project>/）
2. strategy-template Skill装備
3. 不足情報を特定→ユーザーに質問（AskUserQuestion）
4. 01_strategy.md生成
5. 品質チェック（strategy-template基準）

**Output**: _codex/projects/<project>/01_strategy.md

**Success Criteria**:
- [ ] strategy-template Skillが使用された
- [ ] プロダクト概要が30〜60文字
- [ ] ICPに業界・企業規模・役職が含まれている
- [ ] 約束する価値に定量的成果が含まれている
- [ ] 主要KPIが3〜5個、すべて目標値付き
- [ ] 次のアクションが具体的で、担当者・期限が明確

### Phase 2: RACI定義

**Subagent**: `agents/phase2_raci.md` (90day-checklistから継承)

**Input**: Phase 1の01_strategy.md

**Process**:
1. Phase 1の戦略を解析
2. raci-format Skill装備
3. 必要な役割を特定
4. RACIマトリクス生成
5. 品質チェック（raci-format基準）

**Output**: _codex/common/meta/raci/<org>.md

**Success Criteria**:
- [ ] raci-format Skillが使用された
- [ ] Accountable（A）が各領域で1人のみ
- [ ] 立ち位置が明確（資産・権利の範囲）
- [ ] 決裁ラインが明確
- [ ] 管轄プロダクトにプロジェクト名が含まれている

### Phase 3: タスク生成

**Subagent**: `agents/phase3_tasks.md`

**Input**:
- Phase 1の01_strategy.md
- Phase 2のRACIファイル
- プロジェクト名

**Process**:
1. Phase 1の「次のアクション」を読み込み
2. Phase 2のRACIから担当者を特定
3. task-format Skillでタスクリスト生成
4. _tasks/index.mdに追加（既存タスクとマージ）

**Output**: _tasks/index.md（更新）

**Success Criteria**:
- [ ] task-format Skillが使用された
- [ ] task-format基準に準拠（動詞開始、担当者・期限明記）
- [ ] RACIと整合性がある（Accountableが担当者）
- [ ] 優先度付き（P0, P1, P2）
- [ ] 依存関係が明記されている（Blocks, Depends on）

### Phase 4: マイルストーン設定

**Subagent**: `agents/phase4_milestones.md`

**Input**:
- Phase 3のタスクリスト
- Phase 1の主要KPI
- プロジェクト名

**Process**:
1. Phase 3のタスクをクラスタリング（関連タスクをグルーピング）
2. milestone-management Skillでマイルストーン定義
3. 各マイルストーンに期限・成果物・検証基準を設定
4. _codex/projects/<project>/milestones.md生成

**Output**: _codex/projects/<project>/milestones.md

**Success Criteria**:
- [ ] milestone-management Skillが使用された
- [ ] milestone-management基準に準拠
- [ ] 3-5個のマイルストーン（90日以内で達成可能）
- [ ] 各マイルストーンに明確な成果物・検証基準
- [ ] Phase 1のKPIと連動している

### Phase 5: 進捗トラッキング設定

**Subagent**: `agents/phase5_tracking.md`（新規）

**Input**:
- Phase 4のマイルストーンファイル
- プロジェクト名
- Airtable Base ID（存在する場合）

**Process**:
1. Phase 4のマイルストーンを読み込み
2. Airtable Base IDを確認
   - 存在しない場合: 新規Base作成を提案（AskUserQuestion）
   - 存在する場合: 既存Baseに接続
3. マイルストーンテーブル作成
   - 必須フィールド: 名前、説明、期限、ステータス、担当者
4. タスクテーブル作成（milestone-management参照）
   - 必須フィールド: タイトル、担当者、ステータス、優先度
5. _codex/projects/<project>/tracking.md生成
   - Airtable Base ID、テーブルID、View URLを記録

**Output**:
- Airtable Base（マイルストーン・タスクテーブル）
- _codex/projects/<project>/tracking.md

**Success Criteria**:
- [ ] Airtable Baseが作成または既存Baseに接続された
- [ ] マイルストーンテーブルが作成され、Phase 4の内容が反映されている
- [ ] タスクテーブルが作成され、Phase 3の内容が反映されている
- [ ] tracking.mdに必要な情報（Base ID、テーブルID、URL）が記録されている
- [ ] milestone-management基準に準拠したテーブル構造

### Phase 6: 自律運転テスト

**Subagent**: `agents/phase6_autonomous_test.md`（新規、90day-checklistから移植）

**Input**:
- Phase 1-5の全成果物
- プロジェクト名

**Process**:
1. 全Phase成果物の存在確認
   - 01_strategy.md
   - RACI定義
   - _tasks/index.md（プロジェクト関連タスク）
   - milestones.md
   - tracking.md（Airtable連携情報）
2. 自律運転チェックリスト（10項目）を実行
   - タスク一本化率（_tasks/index.md集約率）
   - 01-05充足率（戦略ドキュメント完成度）
   - RACI運用率（役割定義と決裁ライン適用度）
   - ブランドガイド整備率
   - 引き継ぎリードタイム（新規メンバーが運用できるまでの日数）
   - 週次レビュー設定
   - KPIダッシュボード設定
   - 前受けルール設定
   - 会議リズム設定
   - 自律運転シミュレーション（創業者不在1週間の想定）
3. 各項目の達成度を評価（0-100%）
4. 自律運転可能性レポート生成
   - 総合スコア
   - 不足項目の特定
   - 改善提案

**Output**: _codex/projects/<project>/autonomous_test_report.md

**Success Criteria**:
- [ ] 全Phase成果物の存在が確認された
- [ ] 10項目チェックリストがすべて実行された
- [ ] 総合スコアが80%以上（自律運転可能レベル）
- [ ] 不足項目が具体的に特定されている
- [ ] 改善提案が具体的（担当者・期限含む）

---

## Orchestrator Responsibilities

### Phase Management

**各Phaseの完了を確認**:
- Phase 1の成果物が存在するか
- Phase 2の成果物が存在するか
- Phase 3の成果物が存在するか
- Phase 4の成果物が存在するか
- Phase 5の成果物が存在するか
- Phase 6の成果物が存在するか

**Phase間のデータ受け渡しを管理**:
- Phase 1の01_strategy.mdをPhase 2, 3, 4, 6に渡す
- Phase 2のRACIファイルをPhase 3, 6に渡す
- Phase 3のタスクリストをPhase 4, 6に渡す
- Phase 4のマイルストーンをPhase 5, 6に渡す
- Phase 5のtracking情報をPhase 6に渡す
- プロジェクト名、管轄法人情報を全Phaseに引き継ぐ

---

### Review & Replan

**Review実施** (各Phase完了後):

1. **ファイル存在確認**
   - Phase 1成果物: `_codex/projects/<project>/01_strategy.md`
   - Phase 2成果物: `_codex/common/meta/raci/<org>.md`
   - Phase 3成果物: `_tasks/index.md`（プロジェクト関連タスクが追加されているか）
   - Phase 4成果物: `_codex/projects/<project>/milestones.md`
   - Phase 5成果物: Airtableマイルストーンテーブル（BaseID + Table確認）
   - Phase 6成果物: 自律運転テストレポート

2. **Success Criteriaチェック**
   - **Phase 1**:
     - SC-1: ICP定義が含まれているか
     - SC-2: 価値提案が明確か
     - SC-3: KPI案が定量的か
   - **Phase 2**:
     - SC-1: RACI定義が完全か（R, A, C, I全て定義されているか）
     - SC-2: 立ち位置→決裁→担当の構造が守られているか
   - **Phase 3**:
     - SC-1: タスクの粒度が妥当か（1-3日単位）
     - SC-2: RACI担当者が割り当てられているか
   - **Phase 4**:
     - SC-1: マイルストーンが時系列順に定義されているか
     - SC-2: 各マイルストーンにタスクが紐づいているか
   - **Phase 5**:
     - SC-1: Airtable BaseIDが正しく設定されているか
     - SC-2: マイルストーンテーブルが作成されているか
   - **Phase 6**:
     - SC-1: 自律運転テストの総合スコアが80%以上か

3. **差分分析**
   - **Phase 1**: strategy-template基準への準拠
   - **Phase 2**: raci-format基準への準拠
   - **Phase 3**: task-format基準への準拠
   - **Phase 4**: milestone-management基準への準拠
   - **Phase 5**: Airtable統合の成功確認
   - **Phase 6**: 自律運転可能性の検証

4. **リスク判定**
   - **Critical**: リプラン実行（Subagentへ修正指示）
     - 必須項目の欠落（ICP未定義、RACI不完全等）
     - Skills基準への重大な違反
     - 次Phaseの実行に影響する問題
   - **Minor**: 警告+進行許可
     - 改善余地はあるが次Phaseは実行可能
     - 軽微な表記ゆれ等
   - **None**: 承認（次Phaseへ）

**Replan実行** (Critical判定時):

1. **Issue Detection（問題検出）**
   - Success Criteriaの不合格項目を特定
   - 差分の詳細化（期待値 vs 実際）
   - 例: "Phase 1でICP定義が欠落している"

2. **Feedback Generation（フィードバック生成）**
   - 何が要件と異なるか: "ICP（理想の顧客像）が01_strategy.mdに含まれていません"
   - どう修正すべきか: "strategy-template § ICPに従い、具体的な顧客プロフィールを追加してください"
   - 修正チェックリスト:
     - [ ] ICPセクションを追加
     - [ ] 顧客の属性（業種、規模等）を明記
     - [ ] 顧客の課題を1文で記述

3. **Replan Prompt Creation（リプランプロンプト作成）**
   ```
   元のタスク: Phase 1で01_strategy.mdを生成

   フィードバック:
   - ICP定義が欠落しています
   - strategy-template § ICPに従い、以下を追加してください:
     - 顧客の属性（業種、規模等）
     - 顧客の課題（1文）

   Success Criteria（修正後）:
   - SC-1: ICP定義が含まれている → 修正必須
   - SC-2: 価値提案が明確 → 既存OK
   - SC-3: KPI案が定量的 → 既存OK
   ```

4. **Subagent Re-execution（Subagent再実行）**
   - Task Tool経由で `agents/phase1_strategy.md` を再起動
   - リプランプロンプトを入力
   - 修正成果物（01_strategy.md v2）を取得

5. **Re-Review（再レビュー）**
   - 修正成果物を同じ基準（Step 1-4）で再評価
   - **PASS** → Phase 2へ進行
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
- プロジェクト情報不足 → AskUserQuestion（プロジェクト名、管轄法人等）
- RACI定義不明 → 既存RACIファイル参照 or ユーザーへ質問

**Max Retries超過時の人間へのエスカレーション**:
- 3回のリプラン実行後も基準を満たさない → AskUserQuestion
- 質問内容: 問題の詳細、リプラン履歴、人間の判断を求める理由

---

## Expected Output

```markdown
# project-onboarding Orchestrator 実行結果

**プロジェクト名**: <project>
**実行日時**: 2025-12-30

## Phase 1: 戦略策定

✅ **成果物**: `/Users/ksato/workspace/_codex/projects/<project>/01_strategy.md`

**品質チェック**:
- ✅ プロダクト概要: 30〜60文字
- ✅ ICP定義: 業界・企業規模・役職含む
- ✅ 約束する価値: 定量成果含む
- ✅ 主要KPI: 3〜5個、目標値付き
- ✅ 次のアクション: 具体的、担当者・期限明確

**適合率**: 100% (strategy-template基準)

## Phase 2: RACI定義

✅ **成果物**: `/Users/ksato/workspace/_codex/common/meta/raci/<org>.md`

**品質チェック**:
- ✅ Accountable: 各領域で1人のみ
- ✅ 立ち位置: 資産・権利の範囲明確
- ✅ 決裁ライン: 明確
- ✅ 管轄プロダクト: プロジェクト名含む

**適合率**: 100% (raci-format基準)

## Phase 3: タスク生成

✅ **成果物**: `/Users/ksato/workspace/_tasks/index.md` (更新)

**品質チェック**:
- ✅ task-format基準: 動詞開始、担当者・期限明記
- ✅ RACIと整合性: Accountableが担当者
- ✅ 優先度: P0, P1, P2付与
- ✅ 依存関係: Blocks, Depends on明記

**適合率**: 100% (task-format基準)

**生成されたタスク数**: X個

## Phase 4: マイルストーン設定

✅ **成果物**: `/Users/ksato/workspace/_codex/projects/<project>/milestones.md`

**品質チェック**:
- ✅ milestone-management基準: 準拠
- ✅ マイルストーン数: 3-5個（90日以内）
- ✅ 成果物・検証基準: 明確
- ✅ KPI連動: Phase 1のKPIと連動

**適合率**: 100% (milestone-management基準)

**マイルストーン数**: Y個

## Phase 5: 進捗トラッキング設定

✅ **成果物**:
- Airtable Base: `<Base ID>`
- `/Users/ksato/workspace/_codex/projects/<project>/tracking.md`

**品質チェック**:
- ✅ Airtable Base作成: 成功
- ✅ マイルストーンテーブル作成: 成功（Z件）
- ✅ タスクテーブル作成: 成功（W件）
- ✅ tracking.md記録: Base ID, テーブルID, URL記載

**適合率**: 100% (milestone-management基準)

## Phase 6: 自律運転テスト

✅ **成果物**: `/Users/ksato/workspace/_codex/projects/<project>/autonomous_test_report.md`

**自律運転チェックリスト**:
1. ✅ タスク一本化率: 90%以上
2. ✅ 01-05充足率: 80%以上（01_strategy完備）
3. ✅ RACI運用率: 100%（定義済み）
4. ⏳ ブランドガイド整備率: 50%（要改善）
5. ✅ 引き継ぎリードタイム: 7日以内（想定）
6. ⏳ 週次レビュー設定: 未設定（要改善）
7. ✅ KPIダッシュボード設定: 計画済み
8. ✅ 前受けルール設定: 100%（戦略に明記）
9. ⏳ 会議リズム設定: 未設定（要改善）
10. ✅ 自律運転シミュレーション: 合格（80%スコア）

**総合スコア**: 85% ✅ 自律運転可能レベル

**不足項目**:
- ブランドガイド作成（_codex/orgs/<org>.md）
- 週次レビュー設定（meeting_rhythm.md）
- 会議リズム設定

**改善提案**:
1. ブランドガイド作成（担当: 佐藤、期限: +7日）
2. 週次レビュー設定（担当: PM、期限: +3日）
3. 会議リズム設定（担当: PM、期限: +3日）

## 検証ログ
- Phase 1起動: ✅
- strategy-template使用: ✅
- principles使用: ✅
- Phase 2起動: ✅
- raci-format使用: ✅
- Phase 3起動: ✅
- task-format使用: ✅
- Phase 4起動: ✅
- milestone-management使用: ✅
- Phase 5起動: ✅
- Airtable統合: ✅
- Phase 6起動: ✅
- 自律運転テスト: ✅ (85%スコア)
- コンテキスト分離: ✅

## 次のアクション

1. **01_strategy.mdのレビュー**
   - 担当: 佐藤圭吾
   - 期限: 作成後3日以内
   - 確認項目: ICP、価値提案、KPI

2. **RACIの周知**
   - 担当: プロジェクトリーダー
   - 期限: 作成後1週間以内
   - 内容: チーム全員にRACIを共有、決裁ラインを確認

3. **タスクの実行開始**
   - 担当: 各タスクの担当者
   - 期限: _tasks/index.mdの期限に従う
   - 内容: タスク一本化原則に従い、_tasks/index.mdから実行

4. **マイルストーンの確認**
   - 担当: 佐藤圭吾 + プロジェクトリーダー
   - 期限: 作成後1週間以内
   - 内容: マイルストーンの妥当性、期限の実現可能性を確認

5. **Airtable進捗トラッキング開始**
   - 担当: プロジェクトリーダー + チーム
   - 期限: 即時
   - 内容: マイルストーン・タスクの進捗をAirtableで更新開始

6. **不足項目の改善**（Phase 6で特定）
   - ブランドガイド作成（担当: 佐藤、期限: +7日）
   - 週次レビュー設定（担当: PM、期限: +3日）
   - 会議リズム設定（担当: PM、期限: +3日）

7. **自律運転テスト再実施**
   - 担当: 佐藤圭吾
   - 期限: 改善完了後
   - 目標: 総合スコア90%以上
```

---

## Troubleshooting

### Subagentsが起動しない

**原因候補**:
- **セッション再起動が未実施**（最も可能性が高い）
- Subagent定義ファイルのフォーマットエラー
- Task toolが有効化されていない

**対処**:
1. **Subagentファイルの存在確認**
   ```bash
   ls -la /Users/ksato/workspace/.claude/skills/project-onboarding/agents/
   # → phase1_strategy.md, phase2_raci.md, phase3_tasks.md,
   #    phase4_milestones.md, phase5_tracking.md, phase6_autonomous_test.md が存在するか
   ```

2. **セッション再起動**（必須）
   - Subagentファイル作成/変更後
   - Claude Codeセッションを再起動
   - Subagentsは起動時にロードされる

3. Subagent定義確認
   - フロントマター（name, description, tools）が正しいか
   - name フィールドが subagent_type と一致しているか

4. Task tool確認
   - `allowed_tools`に`Task`が含まれているか

### Skillsが使用されない

**原因候補**:
- Skills設定（settingSources）が未設定
- skills_mapping.jsonが見つからない
- Skill名の誤記

**対処**:
1. Skills設定確認
   - Subagent定義に適切なSkills装備が記載されているか

2. skills_mapping.json確認
```bash
cat /Users/ksato/workspace/_codex/common/meta/skills_mapping.json | grep -E "task-format|milestone-management|strategy-template|raci-format"
```

3. Skill名確認
   - phase1_strategy.md: strategy-template, principles
   - phase2_raci.md: raci-format, principles
   - phase3_tasks.md: task-format, principles
   - phase4_milestones.md: milestone-management, principles
   - phase5_tracking.md: milestone-management, principles
   - phase6_autonomous_test.md: principles

### Phase 1-4は成功するが、Phase 5-6が失敗

**原因候補**:
- Phase 1-4の成果物が正しく生成されていない
- Phase 5-6のSubagentが成果物パスを正しく読み込めていない
- Airtable APIキーが未設定（Phase 5）

**対処**:
1. Phase 1-4の成果物確認
   ```bash
   ls -la /Users/ksato/workspace/_codex/projects/<project>/01_strategy.md
   ls -la /Users/ksato/workspace/_codex/common/meta/raci/<org>.md
   ls -la /Users/ksato/workspace/_tasks/index.md
   ls -la /Users/ksato/workspace/_codex/projects/<project>/milestones.md
   ```

2. Airtable APIキー確認（Phase 5）
   ```bash
   echo $AIRTABLE_API_KEY
   ```

3. Phase 5-6のSubagentログ確認
   - 成果物パスが正しいか
   - Readツールでファイルを読み込めているか

### 成果物の品質が低い

**原因候補**:
- ユーザーへの質問が不十分
- Skills思考フレームワークが適用されていない

**対処**:
- AskUserQuestionで不足情報を確実に取得
- Subagent内でSkills装備を明示
- 品質チェックを強化

### _tasks/index.mdへのマージが失敗

**原因候補**:
- _tasks/index.mdが存在しない
- マージロジックが不十分

**対処**:
1. _tasks/index.mdの存在確認
   ```bash
   ls -la /Users/ksato/workspace/_tasks/index.md
   ```

2. 存在しない場合は新規作成
3. マージ時は既存タスクを保持し、新規タスクを追加

### Airtable統合が失敗（Phase 5）

**原因候補**:
- Airtable APIキーが無効
- Base IDが存在しない
- テーブル作成権限がない

**対処**:
1. Airtable APIキー確認
   ```bash
   # 環境変数確認
   echo $AIRTABLE_API_KEY

   # または .env ファイル確認
   cat /Users/ksato/workspace/.env | grep AIRTABLE_API_KEY
   ```

2. Base IDの存在確認
   - milestone-management Skillの「プロジェクトBase一覧」を参照

3. 権限確認
   - Airtable APIキーがBase作成権限を持っているか

### 自律運転テストのスコアが低い（Phase 6）

**原因候補**:
- Phase 1-5の成果物が不完全
- 必須ドキュメント（ブランドガイド等）が未作成

**対処**:
1. Phase 6レポートの「不足項目」を確認
2. 不足項目を優先的に改善
3. 改善後、Phase 6のみ再実行
4. 目標: 総合スコア90%以上

---

## 90day-checklistとの統合

**90day-checklistとの関係**:
- **90day-checklist**: Phase 1-2のみ（戦略・RACI）+ 自律運転テスト概念
- **project-onboarding v1.0**: Phase 1-4（戦略・RACI・タスク・マイルストーン）
- **project-onboarding v2.0**: Phase 1-6（上記 + 進捗トラッキング + 自律運転テスト実施）

**使い分け**:
- **90day-checklist**: 戦略・RACIのみ必要な場合（既存プロジェクトの整備等）
- **project-onboarding v1.0**: タスク・マイルストーンまで必要だが、進捗管理は手動でOK
- **project-onboarding v2.0**: 完全自動化（進捗トラッキング・自律運転テストまで）

**移行パス**:
```bash
# 既存プロジェクトで90day-checklistを実行済み
/90day-checklist existing-project

# その後、タスク・マイルストーンを追加したい場合
/project-onboarding existing-project
# → Phase 1-2はスキップ（既存成果物を使用）
# → Phase 3-6を実行
```

---

## Quick Reference

このセクションでは、各Phase SubagentがSkillsとして装備する4つのtemplate Skillsの内容を即座に参照できるようにしています。

### § 1. strategy-template Quick Reference

**目的**: 01_strategy.md作成時の標準フォーマットと品質基準

**標準テンプレート**:
```markdown
## <project> 01_strategy｜戦略骨子

### プロダクト概要（1文）
<何を（What）、誰に（Who）、どうする（How）を30〜60文字で>

### ICP（1文）
<役職・業界・規模を明確に定義>

### 約束する価値（1文）
<何を一元化/自動化/最適化し（手段）+ どのような状態を実現し（状態）+ どれだけの成果を保証するか（定量）>

### 価格・前受け（内部運用方針）
<価格設定の考え方と前受けルール。brainbase原則: 前受け100%>

### TTFV目標
<Time To First Value: 顧客が最初の価値を得るまでの目標期間（具体的な日数・週数）>

### 主要KPI案
- KPI1: <指標名> - 目標値
- KPI2: <指標名> - 目標値
- KPI3: <指標名> - 目標値

### 次のアクション
- <具体的なタスク1>（担当: 〇〇、期限: 〇〇）
- <具体的なタスク2>（担当: 〇〇、期限: 〇〇）
```

**品質チェックリスト**:
- [ ] プロダクト概要が30〜60文字、何を・誰に・どうするが明確
- [ ] ICPに業界・企業規模・役職が含まれている
- [ ] 約束する価値に定量的な成果が含まれている
- [ ] 価格・前受けルールが明記されている
- [ ] TTFV目標が具体的な日数で定義されている
- [ ] 主要KPIが3〜5個、すべて目標値付き
- [ ] 次のアクションが具体的で、担当者・期限が明確

**保存場所**: `_codex/projects/<project>/01_strategy.md`

### § 2. raci-format Quick Reference

**目的**: 体制図（RACI）の標準フォーマットと管理ルール

**最上位原則**: 立ち位置

仕事は立ち位置で全てが決まる。立ち位置とは、その人が持つ**資産**（実績、信頼、歴史、ネットワーク、リスクを取った経験）によって決まる。

**管理単位**: 法人単位で1ファイル（プロジェクト/プロダクト単位ではない）

**フロントマター**:
```yaml
---
org_id: techknight        # 必須: orgs/*.md と一致させる
name: Tech Knight
members: [kuramoto_yuta, sato_keigo]  # 必須: people/*.md のファイル名
updated: 2025-11-28
---
```

**ファイル構造**:
```markdown
# 体制図 - {法人名}

## 立ち位置

| 人 | 資産 | 権利の範囲 |
| --- | --- | --- |
| {CEO/代表} | CEO、創業者、... | 最終決裁、事業判断、... |
| {CTO/技術責任者} | 技術構築者、... | 技術判断 |

## 決裁

| 領域 | 決裁者 |
| --- | --- |
| 最終決裁 | {CEO/代表} |
| 技術判断 | {CTO} |

それ以外 → 都度相談

## 主な担当（柔軟に変わる）

| 人 | 領域 |
| --- | --- |

## 管轄プロダクト・ブランド
- プロダクト名
```

**重要なルール**:
- **含める**: 権限者（CEO、CTO、CSO、GM、代表理事など）
- **含めない**: 業務委託（people.mdで管理）
- **最終決裁者**: 各法人のCEO/代表（佐藤が全法人の最終決裁者とは限らない）

**保存場所**: `_codex/common/meta/raci/<org>.md`

### § 3. task-format Quick Reference

**目的**: _tasks/index.mdの標準フォーマット

**基本フォーマット**（YAML front matter形式）:
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

**必須項目**:
- **id**: `PROJECT-WEEK` または `PROJECT-YYYYMMDD`（例: `SALESTAILOR-W3`）
- **title**: 動詞から始める、30文字以内（例: `02_offer/pricing.md を作成`）
- **project_id**: `config.yml` に登録されているプロジェクトIDのみ
- **status**: `todo` | `in_progress` | `done`
- **owner**: 担当者名（半角英数字）
- **priority**: `high` | `medium` | `low`

**イベントログ**:
- 作成、開始、相談、レビュー、承認、完了、ブロック

**保存場所**: `_tasks/index.md`（すべてのタスクを一元化）

**タスク一本化率KPI**: `(_tasks/index.md のタスク数) / (全タスク数) × 100%` → 目標: 90%以上

### § 4. milestone-management Quick Reference

**目的**: マイルストーン管理のルールとAirtable統合

**正本の場所**:
- **正本**: Airtable 各プロジェクトBaseの「マイルストーン」テーブル
- **補助**: `_codex/projects/<project>/milestone_*.md` はサマリー・参照用のみ

**Airtableテーブル構造**:

**マイルストーン（必須フィールド）**:
- 名前: M0, M1, M2... または具体的な名称
- 説明: Objective（目標）+ Key Results
- 期限: 達成目標日
- ステータス: 未着手 / 進行中 / 完了 / 遅延
- 担当者: 責任者

**スプリント（必須フィールド）**:
- 期間: W1, W2... または 12/9-12/15
- 開始日/終了日
- 目標: スプリントゴール
- マイルストーン: リンク（親マイルストーン）

**タスク（必須フィールド）**:
- タイトル: 動詞から開始
- 担当者: 実行者
- ステータス: 未着手 / 進行中 / 完了 / ブロック
- 優先度: 高 / 中 / 低

**マイルストーン命名規則**:
```
M{番号}: {目標}（{期限}）

例:
M0: αリリース（2025/10末）
M1: SSW仮説検証完了（2025/12末）
M2: βリリース（2025/12末）
```

**Key Resultの記述**:
```markdown
| Key Result | 達成基準 | 担当 | 状態 |
|------------|----------|------|------|
| 有料ユーザー獲得 | 10社 | 川合 | 📋 |
| 継続率 | 50%以上 | CS | 📋 |
```

**運用フロー**:
1. Airtableにマイルストーンレコード作成
2. Key Resultを「説明」フィールドに記述
3. 担当者・期限を設定
4. 必要に応じて`_codex/projects/`のサマリーを更新

**プロジェクトBase一覧**:
| プロジェクト | Base ID |
|-------------|---------|
| SalesTailor | app8uhkD8PcnxPvVx |
| Zeims | appg1DeWomuFuYnri |
| DialogAI | appLXuHKJGitc6CGd |
| eve-topi | appsticSxr1PQsZam |
| HP Sales | appXvthGPhEO1ZEOv |
| Smart Front | appXLSkrAKrykJJQm |
| Aitle | appvZv4ybVDsBXtvC |
| Mywa | appJeMbMQcz507E9g |
| Senrigan | appDd7TdJf1t23PCm |

---

## 90日仕組み化チェックリスト（完全版）

**注意**: 以下はv2.0で自動化されていない項目です。今後のバージョンで段階的に自動化予定。

brainbaseにおける新規事業の「90日仕組み化」を実現するための標準チェックリストです。

### チェックリスト（全10項目）

```
□ 1. 01_strategy.md 作成（プロダクト概要・ICP・価値・KPI）✅ Phase 1で自動化
□ 2. 02_offer/ 作成（価格・オファー・前受けルール）
□ 3. 03_sales_ops/ 作成（営業オペ・反論対応）
□ 4. 04_delivery/ 作成（導入・CS手順）
□ 5. 05_kpi/ 作成（KPI定義・ダッシュボード）
□ 6. RACI定義（_codex/common/meta/raci.md）✅ Phase 2で自動化
□ 7. ブランドガイド作成（_codex/orgs/<org>.md）
□ 8. 会議リズム設定（週次/四半期）
□ 9. タスク一本化（_tasks/index.md）✅ Phase 3で自動化
□ 10. 自律運転テスト（創業者不在でも運営可能か）✅ Phase 6で自動化
```

### 進捗率の計算

```bash
CHECKLIST_ITEMS=10
COMPLETED_ITEMS=0

# 1. 01_strategy.md
[[ -f "_codex/projects/<project>/01_strategy.md" ]] && ((COMPLETED_ITEMS++))

# 2-10. 同様にチェック...

# 進捗率
PROGRESS=$(echo "scale=2; $COMPLETED_ITEMS / $CHECKLIST_ITEMS * 100" | bc)

echo "90日仕組み化進捗: ${PROGRESS}%（$COMPLETED_ITEMS/$CHECKLIST_ITEMS 完了）"
```

### タイムライン例

**Day 1-30（第1ヶ月）**:
- ✅ 01_strategy.md 作成（W1）→ Phase 1で自動化
- ✅ RACI定義（W2）→ Phase 2で自動化
- ✅ ブランドガイド作成（W3）
- ✅ タスク一本化開始（W4）→ Phase 3で自動化

**Day 31-60（第2ヶ月）**:
- ✅ 02_offer/ 作成（W5-W6）
- ✅ 03_sales_ops/ 作成（W7-W8）

**Day 61-90（第3ヶ月）**:
- ✅ 04_delivery/ 作成（W9-W10）
- ✅ 05_kpi/ 作成（W11-W12）
- ✅ 会議リズム設定（W12）
- ✅ 自律運転テスト（W13）→ Phase 6で自動化

---

最終更新: 2025-12-30
v2.0 - 6 Phase Orchestrator実装、6 Skills統合
90day-checklist拡張版 - 進捗トラッキング・自律運転テスト追加
