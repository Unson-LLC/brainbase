---
title: brainbase運用ガイド（共通エージェント向け）
description: brainbase内部OSの正本を扱うための運用ガイド
project: brainbase - 共通リポジトリOS（全事業統一管理基盤）
version: 1.0
last_updated: 2025-12-02
language: ja
encoding: UTF-8
tags:
  - brainbase
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
5. **プロジェクト探索は必ず `config.yml` の `local.path` を起点とする**（検索結果やシンボリックリンク先に飛びつかない）

## 📂 ディレクトリ構造

### ✅ 正本（編集対象）
```
_codex/
├── common/                    # 必須ルール・決裁・KPI・テンプレ・ナレッジ
│   ├── meta/                  # 人・組織・顧客/契約・RACIの正本
│   ├── templates/             # テンプレート集
│   ├── ops/                   # 運用スクリプト・手順
│   └── assets/                # 共通アセット
├── orgs/                      # 組織別MVV
├── projects/<project>/        # 01–05 の運用ドキュメント
├── brand/                     # ブランドガイド・アセット
├── sns/                       # SNS運用
└── sources/                   # ナレッジソース（参照用）
```

### 📌 プロジェクト側（参照リンクのみ）
```
<project-repo>/
└── docs/ops/
    ├── README.md          # _codex へのリンク集
    ├── 01_strategy.md     # → _codex/projects/<project>/01_strategy.md
    ├── 02_offer.md        # → _codex/projects/<project>/02_offer/
    ├── 03_sales_ops.md    # → _codex/projects/<project>/03_sales_ops/
    ├── 04_delivery.md     # → _codex/projects/<project>/04_delivery/
    └── 05_kpi.md          # → _codex/projects/<project>/05_kpi/
```

## 🎯 対象プロジェクト（config.yml より）
- `salestailor` → `salestailor/`
- `zeims` → `zeims/`
- `tech-knight` → `tech-knight/`
- `baao` → `baao/`
- `unson` → `unson/`
- `ai-wolf` → `personal/ai-wolf/`
- `sato-portfolio` → `personal/sato-portfolio/`

## 📝 ドキュメント作成・更新ルール

### 01_strategy.md 必須項目
```
## <project> 01_strategy｜戦略骨子
### プロダクト概要（1文）
### ICP（1文）
### 約束する価値（1文）
### 価格・前受け（内部運用方針）
### TTFV目標
### 主要KPI案
### 次のアクション
```

### 02_offer/ 構成
- 価格設定の根拠
- オファー構成（パッケージ・プラン）
- 前受けルール（原則100%前受け）

### 03_sales_ops/ 構成
- 営業オペレーション手順
- よくある反論への対応
- セールストーク・スクリプト

### 04_delivery/ 構成
- 導入フロー
- CS手順
- オンボーディング資料

### 05_kpi/ 構成
- KPI定義・目標値
- ダッシュボードリンク
- 計測方法

## 🔄 Knowledge Skills 参照ルール
1) 対話開始時に `_codex/sources/global/*.md` のフロントマターを読み、`skill_id` をキーに索引を作成  
2) ユーザー依頼が索引の `primary_use` / `triggers` / `inputs` に合致した場合のみ本文を追加読み込み  
3) フロントマター必須項目: `skill_id`, `title`, `source_type`, `primary_use`, `triggers`, `inputs`, `outputs`, `granularity`  
4) YAML破損・欠落は無効化し、警告を残す。参照対象は `_codex` 内のみ。

## ✅ タスク管理（_tasks/index.md）
- すべてのタスクは `_tasks/index.md` を唯一の正とする
- プロジェクト固有のタスクも集約
- 記載必須: `[PROJECT-WEEK]` 形式のID / 担当者（R） / 期限 / 成果物
- タスク一本化率目標: 90%以上

## 🔒 RACI運用
- 正本: `_codex/common/meta/raci.md`
- 変更は正本を更新し、プロジェクト側はリンク参照のみ
- RACI運用率目標: 80%以上

## 🎨 ブランドガイド
- `_codex/orgs/<org>.md` にMVVを定義（全組織で整備率100%を目標）

## 📊 主要KPI
1. タスク一本化率 (目標90%)
2. 01–05充足率 (目標100%)
3. RACI運用率 (目標80%)
4. ブランドガイド整備率 (目標100%)
5. 引き継ぎリードタイム ≤7日

## 🚀 90日仕組み化チェックリスト
```
□ 01_strategy.md 作成
□ 02_offer/ 作成
□ 03_sales_ops/ 作成
□ 04_delivery/ 作成
□ 05_kpi/ 作成
□ RACI定義（_codex/common/meta/raci.md）
□ ブランドガイド（_codex/orgs/<org>.md）
□ 会議リズム設定（週次/四半期）
□ タスク一本化（_tasks/index.md）
□ 自律運転テスト（創業者不在でも運営可能か）
```

## 📦 コミットガイド（簡潔版）
- 小さく・こまめに（1論理変更 = 1コミット）
- type例: feat / fix / docs / refactor / chore / style
- 例: `docs: 01_strategy のICPを更新`
- タスクIDがあれば含める（例: `[BRAINBASE-W3] feat: ...`）

## 📐 カスタムプロンプト（共通）
- `/dc`: 技術ドキュメント作成・更新
- `/60`: 既存ドキュメントを100%完成度へ引き上げ
- `/rr`: Web検索による連鎖的深掘り調査（5回反復）
- `/ss`: 全ソースコードの完全分析（3回反復）
- `/uu`: システム・モジュール間インターフェース整合性調査
- `/cr`: コードレビュー・品質保証
- `/ck`: 修正前後の比較チェック
- `/as`: ask cipher（読み出し）
- `/re`: remember cipher（書き込み）
- `/ag`: conductor-agent（最適エージェント自動選択）
- `/tt`: 完全解決まで5回反復サイクル
- `/commit`: 標準コミット実行（ガイドに従ったメッセージ生成）
- `/co`: /compact（コンテキスト圧縮）
- `/ws`: MCP Web検索専用

## 🛡️ 運用上の注意
1. 正本を編集する（_codex 配下）
2. 変更範囲を依頼プロジェクトに限定
3. 破壊的コマンドは事前確認
4. 秘密情報のコミット禁止

## 🔗 参考
- `config.yml` : プロジェクトの正本パス
- `_tasks/index.md` : タスク一元管理
- `_codex/common/meta/` : 人・組織・RACIの正本

最終更新: 2025-12-02 / バージョン: 1.0
