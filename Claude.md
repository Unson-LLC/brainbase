---
title: brainbase運用ガイド
description: Claude Code用 brainbase内部OS運用ドキュメント
author: workspace運用チーム
project: brainbase - 共通リポジトリOS（全事業統一管理基盤）
version: 1.0
last_updated: 2025-11-25
language: ja
encoding: UTF-8
tags:
  - brainbase
  - codex
  - operations
  - knowledge-management
  - multi-project
---

# 🧠 brainbase運用ガイド

全事業を統一OS（判断基準・テンプレ・KPI・RACI・ブランド資産）で動かし、創業者が現場にいなくても週次30分レビューだけで継続運転できる状態をつくる内部運用システム。

## 📚 クイックリファレンス

### 🎯 brainbaseの4大原則
1. **情報の一本化**: すべてのナレッジ・判断基準は `_codex` に集約
2. **タスクの正本化**: タスクは `_tasks/index.md` を唯一の正とする
3. **RACI明確化**: 役割・責任・決裁ラインを `_codex/common/meta/` で一意管理
4. **90日仕組み化**: 新規事業は90日以内に自律運転できる状態をつくる

### 🔧 基本運用ルール
1. 日本語で応答・ドキュメント化
2. 変更は必ず `_codex` 配下の正本を編集（プロジェクト側はリンクのみ）
3. 秘密情報（APIキー・トークン・認証情報）はコミットしない
4. 破壊的変更（大規模削除など）は実行前に必ず確認

## 📂 brainbaseディレクトリ構造

### ✅ 正本（必ず編集する場所）
```
_codex/
├── common/                    # 必須ルール・決裁・KPI・テンプレ・ナレッジ（義務）
│   ├── meta/                  # 人・組織・顧客/契約・RACIの正本
│   │   ├── people.md          # 人物情報の一元管理
│   │   ├── organizations.md   # 組織・法人情報
│   │   ├── clients.md         # 顧客・契約情報
│   │   └── raci.md            # RACI（責任と決裁ライン）
│   ├── decisions/             # 重要な決定記録
│   ├── kpi/                   # 全社共通KPI定義
│   └── templates/             # テンプレート集
│
├── knowledge/                 # フレーム/定石/価値観の原典（任意・参照）
│   └── *.md                   # スキル・ナレッジ（フロントマター必須）
│
├── orgs/                      # 組織別MVV
│   ├── unson.md
│   ├── baao.md
│   ├── salestailor.md
│   ├── techknight.md
│   └── zeims.md
│
└── projects/                  # プロジェクト別運用ドキュメント
    └── <project>/
        ├── 01_strategy.md     # 戦略骨子
        ├── 02_offer/          # 価格・オファー関連
        ├── 03_sales_ops/      # 営業オペ・反論対応
        ├── 04_delivery/       # 導入〜CSの手順
        └── 05_kpi/            # KPI定義・ダッシュボード
```

### 📌 プロジェクト側（参照用リンクのみ配置）
```
<project-repo>/
└── docs/
    └── ops/
        ├── README.md          # _codex へのリンク集
        ├── 01_strategy.md     # → _codex/projects/<project>/01_strategy.md
        ├── 02_offer.md        # → _codex/projects/<project>/02_offer/
        ├── 03_sales_ops.md    # → _codex/projects/<project>/03_sales_ops/
        ├── 04_delivery.md     # → _codex/projects/<project>/04_delivery/
        └── 05_kpi.md          # → _codex/projects/<project>/05_kpi/
```

## 🎯 主要な対象プロジェクト

- `salestailor` → `salestailor/`
- `zeims` → `zeims/`
- `tech-knight` → `tech-knight/`
- `baao` → `baao/`
- `unson` → `unson/`
- `ai-wolf` → `personal/ai-wolf/`
- `sato-portfolio` → `personal/sato-portfolio/`

※ 設定ファイル: `config.yml`
※ 作業前に `config.yml` で `projects[].id` と `local.path` を確認すること

## 📝 運用ドキュメント作成・更新ルール

### 1. 01_strategy.md の必須項目
```markdown
## <project> 01_strategy｜戦略骨子

### プロダクト概要（1文）
### ICP（1文）
### 約束する価値（1文）
### 価格・前受け（内部運用方針）
### TTFV目標
### 主要KPI案
### 次のアクション
```

### 2. 02_offer/ の構成
- 価格設定の根拠
- オファー構成（パッケージ・プラン）
- 前受けルール（brainbaseは原則100%前受け）

### 3. 03_sales_ops/ の構成
- 営業オペレーション手順
- よくある反論への対応
- セールストーク・スクリプト

### 4. 04_delivery/ の構成
- 導入フロー
- CS（カスタマーサクセス）手順
- オンボーディング資料

### 5. 05_kpi/ の構成
- KPI定義・目標値
- ダッシュボードリンク
- 計測方法

## 🔄 Knowledge Skills の参照ルール（AI運用5原則）

### 1. フロントマター仕様（必須）
```yaml
---
skill_id: "skill_name_202X_XX_XX"
title: "スキル名"
source_type: "knowledge | decision | template"
primary_use: "主な用途の説明"
triggers: ["検索キーワード1", "検索キーワード2"]
inputs: ["必要な入力情報"]
outputs: ["生成される出力"]
granularity: "task | workflow | framework"
---
```

### 2. 二段階ロード
1. **索引構築フェーズ**: 対話開始時に `_codex/knowledge/*.md` のフロントマターを読み込み、索引を作成
2. **本文参照フェーズ**: ユーザー依頼が索引の `primary_use` / `triggers` / `inputs` に合致したら、該当スキル本文を追加読み込み

### 3. 検証ルール
- フロントマターが壊れている、または必須項目が欠落するスキルは無効化
- 参照対象は `_codex` 内のみ（外部スキルは未承認として扱う）

## ✅ タスク管理（_tasks/index.md）

### タスクの正本化ルール
- すべてのタスクは `_tasks/index.md` を唯一の正とする
- プロジェクト固有のタスクも `_tasks/index.md` に集約
- タスクには必ず以下を明記：
  - `[PROJECT-WEEK]` 形式のID（例: `BRAINBASE-W3`）
  - 担当者（RACI の Responsible）
  - 期限
  - 成果物

### タスク一本化率KPI
```
タスク一本化率 = (_tasks/index.md に記載されたタスク数) / (全タスク数) × 100%
```
目標: 90%以上

## 🔒 RACI運用ルール

### RACI定義の正本
- 場所: `_codex/common/meta/raci.md`
- 変更時: 必ず正本を更新し、プロジェクト側はリンク参照のみ

### RACI要素
- **R (Responsible)**: 実行責任者
- **A (Accountable)**: 説明責任者・最終決裁者
- **C (Consulted)**: 事前相談先
- **I (Informed)**: 事後報告先

### 運用率KPI
```
RACI運用率 = (RACI定義済みタスク数) / (全タスク数) × 100%
```
目標: 80%以上

## 🎨 ブランドガイド整備

### 組織別MVV（_codex/orgs/）
各法人・組織のMission・Vision・Valueを定義：
- `unson.md` - UNSON株式会社
- `baao.md` - BAAO事業
- `salestailor.md` - SalesTailor事業
- `techknight.md` - Tech Knight Inc
- `zeims.md` - Zeims事業

### ブランドガイド整備率KPI
```
整備率 = (MVV定義済み組織数) / (全組織数) × 100%
```
目標: 100%

## 📊 主要KPI一覧

1. **タスク一本化率**: `_tasks/index.md` への集約率 → 目標90%
2. **01–05充足率**: 事業ごとのOS完成度 → 目標100%
3. **RACI運用率**: 役割定義と行動ルールの適用度 → 目標80%
4. **ブランドガイド整備率**: 組織単位のMVV定義 → 目標100%
5. **引き継ぎリードタイム**: 新規メンバーが理解→運用できるまでの日数 → 目標7日以内

## 🚀 新規事業の90日仕組み化チェックリスト

新規事業立ち上げ時、90日以内に以下を完了すること：

```
□ 01_strategy.md 作成（プロダクト概要・ICP・価値・KPI）
□ 02_offer/ 作成（価格・オファー・前受けルール）
□ 03_sales_ops/ 作成（営業オペ・反論対応）
□ 04_delivery/ 作成（導入・CS手順）
□ 05_kpi/ 作成（KPI定義・ダッシュボード）
□ RACI定義（_codex/common/meta/raci.md）
□ ブランドガイド作成（_codex/orgs/<org>.md）
□ 会議リズム設定（週次/四半期）
□ タスク一本化（_tasks/index.md）
□ 自律運転テスト（創業者不在でも運営可能か）
```

## 📦 コミットルール

### 自動提案タイミング
以下の条件を満たしたら、Claudeは自発的に `/commit` の実行を提案する：
- 論理的なまとまりの変更が完了した時
- ユーザーが「できた」「完了」「OK」など完了を示唆した時
- 複数ファイルの関連変更が一段落した時

### コミットメッセージフォーマット
```
<type>: <summary>（日本語可、50文字以内）

<why>
- なぜこの変更をしたのか（会話の文脈から）
- 何を達成しようとしていたのか

<what>（変更が多い場合のみ）
- 主な変更点1
- 主な変更点2

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>
```

### type一覧
- `feat`: 新機能・新規追加
- `fix`: バグ修正
- `docs`: ドキュメントのみの変更
- `refactor`: リファクタリング（機能変更なし）
- `chore`: ビルド・設定・運用系の変更
- `style`: フォーマット変更（機能に影響なし）

### 例
```
docs: プロジェクトファイルをproject.mdに統合

なぜ:
- MCP Serverでコンテキスト自動ロードするため
- 01-05の分散管理より1ファイルの方が扱いやすい

変更:
- 13プロジェクトのproject.md作成
- architecture_map.mdに新構造を反映

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>
```

### コミット頻度
- 小さく・こまめに（1つの論理的変更 = 1コミット）
- 大きな変更は分割してコミット

### コミット粒度ルール（1タスク1コミット）
- **1タスク = 1コミット**: `_tasks/index.md` のタスク1件に対してコミット1件を対応させる
- コミットメッセージに対応するタスクIDを含める（例: `[TECHKNIGHT-HP-SALES]`）
- 複数タスクにまたがる変更は分割してコミット
- タスクIDがない軽微な変更（typo修正等）は例外として許容

## 🛡️ Claude運用上の注意事項

### 必須ルール
1. **正本を編集**: `_codex` 配下のファイルを直接編集（プロジェクト側は触らない）
2. **変更範囲の限定**: 依頼されたプロジェクトに限定し、他プロジェクトは触らない
3. **破壊的コマンド禁止**: 大規模削除、`git reset --hard` などは実行前に必ず確認
4. **秘密情報の保護**: APIキー・トークン・認証情報はコミット禁止

### 推奨ワークフロー
1. `config.yml` で対象プロジェクトを確認
2. `_codex/projects/<project>/` で運用ドキュメントを確認
3. `_codex/common/meta/` でRACIを確認
4. 変更時は正本（`_codex`）を編集
5. プロジェクト側は参照リンクのみ配置

## カスタムプロンプト

brainbase運用に特化したカスタムコマンド：

### ドキュメント作成・更新
- `/dc`: 技術ドキュメント作成・更新（`technical-documentation-writer`エージェント）
- `/60`: 現在のドキュメントを100%完成度に引き上げる

### 調査・分析
- `/rr`: Web検索による連鎖的深掘り調査（5回反復）
- `/ss`: 全ソースコードの完全分析（3回反復）
- `/uu`: システム・モジュール間のインターフェース整合性調査

### 品質管理
- `/cr`: コードレビュー・品質保証
- `/ck`: 修正前後の比較チェック

### メモリ管理
- `/as`: `ask cipher`（読み出し）
- `/re`: `remember cipher`（書き込み）

### エージェント統括
- `/ag`: `conductor-agent` 実行（最適なエージェントを自動選択）
- `/tt`: 完全解決まで5回反復サイクル処理

### Git操作
- `/commit`: 標準コミット実行（ルールに従ったメッセージ生成）

### その他
- `/co`: `/compact`（コンテキスト圧縮）
- `/ws`: MCP Web検索専用

## 🔗 関連ドキュメント

- **[Agents.md](/Users/ksato/workspace/Agents.md)** - ワークスペース全体の共通ルール
- **[config.yml](/Users/ksato/workspace/config.yml)** - プロジェクト設定
- **[_tasks/index.md](/Users/ksato/workspace/_tasks/index.md)** - タスク一元管理
- **[_codex/common/meta/](/Users/ksato/workspace/_codex/common/meta/)** - 人・組織・RACI正本

---

最終更新: 2025-11-25
バージョン: 1.0
管理者: workspace運用チーム
