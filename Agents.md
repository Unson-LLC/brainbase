# Agents Guide (workspace root)

このワークスペースで Claude / Codex などのエージェントを動かすときの共通ルールをまとめています。各プロジェクト個別のガイドがある場合は、そちらを最優先してください。

## 1. まず config.yml で対象プロジェクトを確認
- 設定ファイル: `config.yml`
- `projects[].id` と `local.path` を見て、作業するリポジトリに `cd` してから着手してください。
- 例: `id: salestailor` → `cd salestailor`

## 2. プロジェクト固有のガイドを読む
以下のリポジトリには専用のガイドがあります。作業前に必ず目を通してください。
- `tech-knight/app/Aitle/AGENTS.md`
- `personal/FX/AGENTS.md`
- `unson/app/ncom-catalyst/AGENTS.md`

## 3. 共通方針
- 言語: 日本語で応答・ドキュメント化する（既存方針に従う）。
- 変更範囲は依頼されたプロジェクトに限定し、他プロジェクトのファイルは触らない。
- 秘密情報（APIキー・トークン・認証情報）はコミットしない。`.env` 類はテンプレートを使用。
- 破壊的コマンド（大規模削除、`git reset --hard` など）は実行前に必ず確認。

## 4. 運用ドキュ構造（codex と各プロジェクトの対応）
- 正本は `_codex/` 配下に集約。プロジェクト内 `docs/ops/` はリンクのみを置き、編集は `_codex` 側で行う。
- codex の構成（概略）
  - `_codex/common/00_common/` 必須ルール・決裁・KPI・決定プロトコル（義務）
  - `_codex/common/00_common/knowledge/` フレーム/定石/価値観の原典（任意・参照）
  - `_codex/common/meta/` 人・組織タグ・顧客/契約・RACIの正本（責任と契約ラインの一意表）
  - `_codex/projects/<project>/01_strategy.md` 戦略骨子
  - `_codex/projects/<project>/02_offer/` 価格・オファー関連
  - `_codex/projects/<project>/03_sales_ops/` 営業オペ・反論対応など
  - `_codex/projects/<project>/04_delivery/` 導入〜CSの手順
  - `_codex/projects/<project>/05_kpi/` KPI定義・ダッシュボードリンク
- プロジェクト側（例: zeims/, salestailor/, tech-knight/app/Aitle/, unson/）
  - `docs/ops/README.md` と 01〜05 の各 md を配置し、正本の `_codex` パスのみ明記（参照用）。
  - 人/組織/契約/RACI は `_codex/meta` を参照（プロジェクト側はリンクのみ）。
  - 変更が必要な場合は `_codex` を編集し、プロジェクト側はリンク先を更新するだけ。

## 4. 参考：config.yml に登録されているプロジェクト
- `salestailor` → `salestailor/`
- `zeims` → `zeims/`
- `tech-knight` → `tech-knight/`
- `baao` → `baao/`
- `unson` → `unson/`
- `ai-wolf` → `personal/ai-wolf/`
- `sato-portfolio` → `personal/sato-portfolio/`

不明点があれば、対象リポジトリ内の AGENTS/CLAUDE ガイドか README を先に確認してください。
