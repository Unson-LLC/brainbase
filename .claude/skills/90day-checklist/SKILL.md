---
name: 90day-checklist
description: brainbaseにおける新規事業の「90日仕組み化」を実現するための標準チェックリスト。全10項目（01_strategy作成、02_offer作成、RACI定義、ブランドガイド、自律運転テストなど）を90日以内に完了。新規事業の進捗を確認する際に使用。
---

# 90日仕組み化チェックリスト

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
