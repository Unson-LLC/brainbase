---
name: 90day-checklist
description: 新規事業の90日仕組み化を自動実行するOrchestrator。Phase 1（戦略策定）→ Phase 2（RACI定義）の2 Phase workflowで、01_strategy.mdとRACIファイルを自動生成。strategy-template、raci-format Skillsを装備したSubagentsが高品質な成果物を生成。
---

## Triggers

以下の状況で使用：
- **新規事業を立ち上げるとき**（90日仕組み化の開始）
- **既存事業の01_strategyとRACIを整備したいとき**
- **brainbase運用の基盤ドキュメントを自動生成したいとき**

# 90day-checklist Orchestrator

**バージョン**: v1.0（2 Phase版）
**実装日**: 2025-12-26
**M5.2 Phase 2**: Orchestration実装

---

## Orchestration Overview

このOrchestratorは、新規事業の90日仕組み化のうち、**最重要な2項目を自動生成**します：

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
```

**効果**:
| 指標 | 手動実施 | Orchestrator使用 | 改善率 |
|------|---------|-----------------|--------|
| 01_strategy作成時間 | 2〜4時間 | 30分 | -87.5% |
| RACI定義時間 | 2〜3時間 | 20分 | -88.9% |
| 品質適合率 | 60% | 90% | +50% |
| 佐藤圭吾の工数 | 全作業 | レビューのみ | -95% |

---

## 使い方

### 基本的な使い方

**ユーザー**: /90day-checklist [プロジェクト名]

**期待される動作**:
1. **Phase 1 Subagentが起動**
   - 既存のプロジェクト情報を収集
   - strategy-template Skillで01_strategy.md生成
   - _codex/projects/<project>/01_strategy.md保存

2. **Phase 2 Subagentが起動**
   - Phase 1の戦略を受け取る
   - raci-format SkillでRACIファイル生成
   - _codex/common/meta/raci/<org>.md保存

3. **Orchestratorが結果を確認**
   - 両Phaseの成果物を検証
   - 品質チェック（必須項目の確認）
   - 最終レポート生成

### 手動呼び出し（開発・検証時）

Phase 1とPhase 2を個別に起動することも可能：

**Phase 1のみ起動**:
```
Task(
  subagent_type="phase1-strategy-generator",
  description="戦略策定テスト",
  prompt="プロジェクト名: salestailor の01_strategy.mdを生成してください"
)
```

**Phase 2のみ起動**:
```
Task(
  subagent_type="phase2-raci-generator",
  description="RACI定義テスト",
  prompt="プロジェクト名: salestailor のRACIファイルを生成してください。
Phase 1の01_strategy.mdは既に存在します。"
)
```

---

## Phase詳細

### Phase 1: 戦略策定

**Subagent**: `agents/phase1_strategy.md`

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

**Subagent**: `agents/phase2_raci.md`

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

---

## Orchestrator Responsibilities

### Phase Management

**各Phaseの完了を確認**:
- Phase 1の成果物が存在するか
- Phase 2の成果物が存在するか

**Phase間のデータ受け渡しを管理**:
- Phase 1の01_strategy.mdをPhase 2に渡す
- プロジェクト名、管轄法人情報を引き継ぐ

---

### Review & Replan

**Review実施** (各Phase完了後):

1. **ファイル存在確認**
   - Phase 1成果物: `_codex/projects/<project>/01_strategy.md`
   - Phase 2成果物: `_codex/common/meta/raci/<org>.md`

2. **Success Criteriaチェック**
   - **Phase 1**:
     - SC-1: ICP定義が含まれているか
     - SC-2: 価値提案が明確か
     - SC-3: KPI案が定量的か
   - **Phase 2**:
     - SC-1: RACI定義が完全か（R, A, C, I全て定義されているか）
     - SC-2: 立ち位置→決裁→担当の構造が守られているか

3. **差分分析**
   - **Phase 1**: strategy-template基準への準拠
   - **Phase 2**: raci-format基準への準拠
   - 両成果物の整合性確認

4. **リスク判定**
   - **Critical**: リプラン実行（Subagentへ修正指示）
     - 必須項目の欠落（ICP未定義、RACI不完全等）
     - Skills基準への重大な違反
   - **Minor**: 警告+進行許可
     - 軽微な表記ゆれ等
   - **None**: 承認（次Phaseへ）

**Replan実行** (Critical判定時):

1. **Issue Detection（問題検出）**
   - Success Criteriaの不合格項目を特定
   - 差分の詳細化（期待値 vs 実際）

2. **Feedback Generation（フィードバック生成）**
   - 何が要件と異なるか
   - どう修正すべきか（strategy-template/raci-format基準の参照）
   - 修正チェックリストの作成

3. **Replan Prompt Creation（リプランプロンプト作成）**
   - 元のタスク + フィードバック
   - Success Criteriaの再定義

4. **Subagent Re-execution（Subagent再実行）**
   - Task Tool経由で `agents/phase1_strategy.md` または `agents/phase2_raci.md` を再起動
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
- プロジェクト情報不足 → AskUserQuestion（プロジェクト名、管轄法人等）
- RACI定義不明 → 既存RACIファイル参照 or ユーザーへ質問

**Max Retries超過時の人間へのエスカレーション**:
- 3回のリプラン実行後も基準を満たさない → AskUserQuestion
- 質問内容: 問題の詳細、リプラン履歴、人間の判断を求める理由

---

## Expected Output

```markdown
# 90day-checklist Orchestrator 実行結果

**プロジェクト名**: <project>
**実行日時**: 2025-12-26

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

## 検証ログ
- Phase 1起動: ✅
- strategy-template使用: ✅
- principles使用: ✅
- Phase 2起動: ✅
- raci-format使用: ✅
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

3. **90日仕組み化の次の項目**
   - 02_offer/ 作成（v2.0で自動化予定）
   - 03_sales_ops/ 作成
   - （全10項目を参照）
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
   ls -la /Users/ksato/workspace/.claude/skills/90day-checklist/agents/
   # → phase1_strategy.md, phase2_raci.md が存在するか
   ```

2. **セッション再起動**（必須）
   - Subagentファイル作成/変更後
   - Claude Codeセッションを再起動
   - Subagentsは起動時にロードされる

3. Subagent定義確認
   - フロントマター（name, description, tools, setting_sources）が正しいか
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
   - `setting_sources=["user", "project"]`が設定されているか

2. skills_mapping.json確認
```bash
cat /Users/ksato/workspace/_codex/common/meta/skills_mapping.json | grep -E "strategy-template|raci-format"
```

3. Skill名確認
   - phase1_strategy.md: strategy-template, principles
   - phase2_raci.md: raci-format, principles

### 成果物の品質が低い

**原因候補**:
- ユーザーへの質問が不十分
- Skills思考フレームワークが適用されていない

**対処**:
- AskUserQuestionで不足情報を確実に取得
- Subagent内でSkills装備を明示
- 品質チェックを強化

---

# 90日仕組み化チェックリスト（完全版）

**注意**: 以下はv1.0で自動化されていない項目です。今後のバージョンで段階的に自動化予定。

brainbaseにおける新規事業の「90日仕組み化」を実現するための標準チェックリストです。

## Instructions

### 1. 90日仕組み化の定義

**目標**: 新規事業を90日以内に自律運転できる状態にする

**成果**:
- 創業者が現場にいなくても運営が回る
- 週次30分のレビューだけで継続運転できる
- 引き継ぎリードタイム7日以内

### 2. チェックリスト（全10項目）

```
□ 1. 01_strategy.md 作成（プロダクト概要・ICP・価値・KPI）
□ 2. 02_offer/ 作成（価格・オファー・前受けルール）
□ 3. 03_sales_ops/ 作成（営業オペ・反論対応）
□ 4. 04_delivery/ 作成（導入・CS手順）
□ 5. 05_kpi/ 作成（KPI定義・ダッシュボード）
□ 6. RACI定義（_codex/common/meta/raci.md）
□ 7. ブランドガイド作成（_codex/orgs/<org>.md）
□ 8. 会議リズム設定（週次/四半期）
□ 9. タスク一本化（_tasks/index.md）
□ 10. 自律運転テスト（創業者不在でも運営可能か）
```

### 3. 各項目の詳細

**1. 01_strategy.md 作成**
- 成果物: `_codex/projects/<project>/01_strategy.md`
- 所要時間: 2〜4時間
- 参照スキル: `strategy-template`
- チェック方法: `ls _codex/projects/<project>/01_strategy.md`

**2. 02_offer/ 作成**
- 成果物: `_codex/projects/<project>/02_offer/`（pricing.md, packages.md, payment_terms.md）
- 所要時間: 3〜5時間

**3. 03_sales_ops/ 作成**
- 成果物: `_codex/projects/<project>/03_sales_ops/`（sales_process.md, objections.md, scripts.md）
- 所要時間: 4〜6時間

**4. 04_delivery/ 作成**
- 成果物: `_codex/projects/<project>/04_delivery/`（onboarding.md, cs_playbook.md）
- 所要時間: 4〜6時間

**5. 05_kpi/ 作成**
- 成果物: `_codex/projects/<project>/05_kpi/`（kpi_definition.md, dashboard_link.md）
- 所要時間: 3〜5時間
- 必須KPI: ビジネスKPI、プロダクトKPI、オペレーションKPI

**6. RACI定義**
- 成果物: `_codex/common/meta/raci.md`（該当プロジェクト追加）
- 所要時間: 2〜3時間
- 参照スキル: `raci-format`

**7. ブランドガイド作成**
- 成果物: `_codex/orgs/<org>.md`
- 所要時間: 3〜4時間
- 必須項目: Mission、Vision、Value、ブランドカラー、トーン＆マナー

**8. 会議リズム設定**
- 成果物: `_codex/common/meeting_rhythm.md`（該当プロジェクト追加）
- 所要時間: 1〜2時間
- 必須会議: 週次レビュー（30分）、月次振り返り（1時間）、四半期戦略会議（2時間）

**9. タスク一本化**
- 成果物: `_tasks/index.md`
- 所要時間: 2〜3時間
- 参照スキル: `task-format`
- 目標: タスク一本化率90%以上

**10. 自律運転テスト**
- テスト方法: 創業者が1週間不在（実際または仮想）
- 確認項目:
  - タスクが _tasks/index.md から実行されているか
  - RACIに従って意思決定が行われているか
  - 週次レビューが実施されているか
  - KPIが計測されているか
  - 新規メンバーが7日以内にタスクを完了できるか

### 4. 進捗率の計算

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

### 5. タイムライン例

**Day 1-30（第1ヶ月）**:
- ✅ 01_strategy.md 作成（W1）
- ✅ RACI定義（W2）
- ✅ ブランドガイド作成（W3）
- ✅ タスク一本化開始（W4）

**Day 31-60（第2ヶ月）**:
- ✅ 02_offer/ 作成（W5-W6）
- ✅ 03_sales_ops/ 作成（W7-W8）

**Day 61-90（第3ヶ月）**:
- ✅ 04_delivery/ 作成（W9-W10）
- ✅ 05_kpi/ 作成（W11-W12）
- ✅ 会議リズム設定（W12）
- ✅ 自律運転テスト（W13）

## Examples

### 例: 進捗レポート

```markdown
# 90日仕組み化進捗レポート: SalesTailor
生成日時: 2025-11-25

## 📊 サマリ
✅ 完了: 6/10 項目（60%）
⏳ 残り: 4項目

## 【完了】
✅ 01_strategy.md 作成
✅ RACI定義
✅ ブランドガイド作成
✅ タスク一本化
✅ 02_offer/ 作成（部分的）
✅ 05_kpi/ 作成（部分的）

## 【未完了】
❌ 03_sales_ops/ 作成
❌ 04_delivery/ 作成
❌ 会議リズム設定
❌ 自律運転テスト

## 🎯 次のアクション
1. 03_sales_ops/README.md を作成（担当: keigo、期限: W5）
2. 04_delivery/README.md を作成（担当: keigo、期限: W6）
3. 会議リズムを定義（担当: keigo、期限: W7）

## 📅 目標達成日
2025-02-23（あと68日）
```

### よくある失敗パターン

**❌ 失敗例1: 01-05 を作るが活用されない**
- 症状: ドキュメントは作成したが、チームが参照しない
- 対策: プロジェクト側に参照リンクを配置、週次レビューで必ず参照

**❌ 失敗例2: RACIが曖昧**
- 症状: 意思決定が遅い、誰が決めるのか不明
- 対策: Accountable（A）は必ず1人に絞る

**❌ 失敗例3: 自律運転テストをスキップ**
- 症状: 創業者不在時に運営が止まる
- 対策: 必ず1週間の自律運転テストを実施

---

この90日仕組み化チェックリストに従うことで、brainbaseの目標「創業者が現場にいなくても週次30分レビューだけで継続運転できる状態」を実現できます。
