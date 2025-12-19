---
name: milestone-management
description: brainbaseにおけるマイルストーン管理のルール。正本はAirtable（各プロジェクトBase）の「マイルストーン」テーブル。_codex/projects/のmdファイルは参照用サマリーとして補助的に使用。新規マイルストーン作成・更新時に使用。
---

## Triggers

以下の状況で使用：
- 新規マイルストーンを作成するとき
- プロジェクトの進捗状況を更新するとき
- マイルストーン管理の正本がどこか確認したいとき

# マイルストーン管理ルール

## 正本の場所

**正本**: Airtable 各プロジェクトBaseの「マイルストーン」テーブル
**補助**: `_codex/projects/<project>/milestone_*.md` はサマリー・参照用のみ

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

## Airtableテーブル構造

### マイルストーン（必須フィールド）

- **名前**: M0, M1, M2... または具体的な名称
- **説明**: Objective（目標）+ Key Results
- **期限**: 達成目標日
- **ステータス**: 未着手 / 進行中 / 完了 / 遅延
- **担当者**: 責任者

### スプリント（必須フィールド）

- **期間**: W1, W2... または 12/9-12/15
- **開始日/終了日**
- **目標**: スプリントゴール
- **マイルストーン**: リンク（親マイルストーン）

### タスク（必須フィールド）

- **タイトル**: 動詞から開始
- **担当者**: 実行者
- **ステータス**: 未着手 / 進行中 / 完了 / ブロック
- **優先度**: 高 / 中 / 低

## マイルストーン命名規則

**フォーマット**: `M{番号}: {目標}（{期限}）`

```
M0: αリリース（2025/10末）
M1: SSW仮説検証完了（2025/12末）
M2: βリリース（2025/12末）
M3: 正式リリース（2026/1末）
```

**番号の意味**:
- M0: 初期リリース・基盤構築
- M1-M2: SPF（Solution/Product Fit）段階
- M3-M4: PMF（Product/Market Fit）検証段階
- M5以降: スケール・最適化段階

## Key Resultの記述

各マイルストーンに**達成基準**を設定：

```markdown
| Key Result | 達成基準 | 担当 | 状態 |
|------------|----------|------|------|
| 有料ユーザー獲得 | 10社 | 川合 | 📋 |
| 継続率 | 50%以上 | CS | 📋 |
| NPS | 30以上 | CS | 📋 |
```

**状態**: ✅完了 / ⏳進行中 / 📋未着手 / 🚫ブロック

## _codex/projects/ のサマリーファイル

**用途**: 戦略的コンテキストの参照（正本ではない）

**ファイル名**: `milestone_spf_pmf.md` または `milestone_operational.md`

**含めるべき**:
- フィットジャーニー上の位置
- PMF達成の定義（定性・定量）
- タイムライン概観
- 優先度マトリクス
- 競合環境と差別化
- 体制・リスク・次のアクション

**含めない**（Airtableが正本）:
- 個別タスクの詳細
- スプリント単位の進捗
- 日次の作業ログ

## 運用フロー

### 新規マイルストーン作成

1. Airtableにマイルストーンレコード作成
2. Key Resultを「説明」フィールドに記述
3. 担当者・期限を設定
4. 必要に応じて`_codex/projects/`のサマリーを更新

### 進捗更新

1. Airtableのステータス・進捗率を更新
2. ブロッカーがあれば記録
3. スプリント/タスクをリンク

### マイルストーン完了

1. Airtableでステータスを「完了」に変更
2. 完了日を記録
3. 学びを記録（レトロスペクティブ）
4. `_codex/projects/`のサマリーに実績を反映

## saas-ai-roadmap-playbookとの連携

マイルストーン設計時は`skill: saas-ai-roadmap-playbook`を参照：

- **CPF → PSF → SPF → PMF** のフェーズ設計
- **OKR/KPI** によるKey Result設定
- **Must Have / Nice to Have / Not Now** の優先度分類
- **Build-Measure-Learn** サイクルの組み込み

## 例: Airtableマイルストーンレコード

```
名前: M2: βリリース（決済付き一般公開）
説明: |
  Objective: 決済機能込みで一般公開

  Key Results:
  - 支払い機能リリース（決済フロー稼働）
  - ChatGPT-5.1切り替え（モデル更新）
  - LP正式公開（ロゴ掲載4件）

  ブロッカー:
  - 支払い関連機能の実装遅延
期限: 2025-12-31
ステータス: 進行中
進捗率: 40%
担当者: 太田
```

## よくある失敗パターン

**❌ mdファイルを正本として運用**
→ ✅ Airtableを正本、mdはサマリー

**❌ Key Resultが曖昧**（例: ユーザーを増やす）
→ ✅ 定量的に（例: 有料ユーザー10社獲得）

**❌ マイルストーンとタスクの混同**（例: M1: バグ修正）
→ ✅ マイルストーンは「達成状態」、タスクは「作業」

---
最終更新: 2025-12-19
