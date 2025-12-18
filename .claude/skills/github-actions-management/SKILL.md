---
name: github-actions-management
description: GitHub Actionsワークフローの作成・変更時に守る管理ルールとドキュメント更新手順。
---
# GitHub Actions管理ルール

## 概要

GitHub Actionsワークフローを作成・変更した際の管理ルール。

## 必須アクション

### ワークフロー作成時

1. **管理ドキュメントを更新**: `_codex/common/ops/scheduled-jobs.md`
   - スケジュール実行の場合: 「スケジュール実行」テーブルに追加
   - イベントトリガーの場合: 「イベントトリガー実行」テーブルに追加
   - 必要なSecretsがあれば「必要なSecrets」セクションに追加

2. **ランナー選択基準**:
   - `ubuntu-latest`（クラウド）: 外部API呼び出しのみで完結するジョブ
   - `[self-hosted, local]`（セルフホスト）: ローカルファイルアクセスが必要なジョブ

### 記載項目

| 項目 | 内容 |
|------|------|
| ジョブ名 | わかりやすい日本語名 |
| スケジュール | JST表記（例: 毎日 21:00 JST） |
| 目的 | 何をするか簡潔に |
| ワークフロー | `.github/workflows/xxx.yml` |
| ランナー | ubuntu-latest または self-hosted |

## 参照

- 管理ドキュメント: `_codex/common/ops/scheduled-jobs.md`
- ワークフロー置き場: `.github/workflows/`
- セルフホストランナー設定: `~/actions-runner/`

## 例

```markdown
| mana日次処理 | 毎日 21:00 JST | Airtableスプリントに日次ログ追記 | `.github/workflows/mana-daily.yml` | ubuntu-latest |
```
