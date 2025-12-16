---
name: mana-deployment
description: mana（Slack AI PM agent）のLambdaデプロイ手順。deploy.shを使った3ワークスペース同時デプロイの方法を定義
tags: [mana, deployment, aws, lambda, slack]
location: project
---

# mana Deployment Guide

## 概要

mana（AI PM agent）は、3つのSlackワークスペース用にそれぞれ独立したAWS Lambda関数としてデプロイされる。

## デプロイ対象

| Lambda関数名 | ワークスペース | チャンネルマッピング |
|-------------|--------------|---------------------|
| `mana` | UNSON | UNSONワークスペースの全チャンネル |
| `mana-salestailor` | SalesTailor | SalesTailorワークスペースの全チャンネル（#eng等） |
| `mana-techknight` | Tech Knight | Tech Knightワークスペースの全チャンネル |

## デプロイ方法

### 1. 標準デプロイ（全Lambda関数）

```bash
cd /Users/ksato/workspace/mana
bash deploy.sh
```

**処理内容:**
1. TypeScriptビルド（Mastra）
2. 依存関係のインストール
3. ツール実行テスト
4. Lambdaパッケージの作成（function.zip）
5. 3つのLambda関数への同時デプロイ
6. 環境変数の更新（manaのみ）

### 2. ワークスペース別デプロイ

特定のワークスペースのみデプロイする場合：

```bash
cd /Users/ksato/workspace/mana
bash deploy-salestailor.sh  # SalesTailorワークスペースのみ
```

## 環境変数管理

環境変数は**ワークスペースごとに異なる**ため、個別に管理：

- **mana**: `api/env.json` から自動更新
- **mana-salestailor**: AWSコンソールで手動設定
- **mana-techknight**: AWSコンソールで手動設定

### 必須環境変数

```json
{
  "Variables": {
    "SLACK_BOT_TOKEN": "xoxb-...",
    "SLACK_SIGNING_SECRET": "...",
    "SLACK_BOT_ID": "U...",
    "WORKSPACE_ID": "T...",
    "GITHUB_TOKEN": "ghp_...",
    "GITHUB_OWNER": "Unson-LLC",
    "GITHUB_REPO": "brainbase",
    "S3_BUCKET": "brainbase-source-593793022993",
    "AIRTABLE_API_KEY": "pat..."
  }
}
```

## デプロイ後の確認

1. **Lambda関数URL確認:**
   ```bash
   aws lambda get-function-url-config \
     --function-name mana-salestailor \
     --region us-east-1 \
     --profile k.sato
   ```

2. **ログ確認:**
   ```bash
   aws logs tail /aws/lambda/mana-salestailor --follow \
     --region us-east-1 \
     --profile k.sato
   ```

3. **Slackでテスト:**
   - SalesTailorワークスペースの#engチャンネルで `@mana タスク登録テスト`
   - project_idが `proj_salestailor` になることを確認

## トラブルシューティング

### デプロイ失敗: TypeScriptビルドエラー

```bash
cd /Users/ksato/workspace/mana/api
npx tsc -p tsconfig.mastra.json
# エラーを確認して修正
```

### デプロイ失敗: ツール実行テスト失敗

```bash
cd /Users/ksato/workspace/mana/api
node scripts/test-tools-execution.mjs
# ローカルではAWS認証エラーは正常（Lambda上では動作する）
```

### Lambda関数が古いコードを実行している

デプロイ後5秒待機しているが、即座に確認する場合：

```bash
aws lambda wait function-updated \
  --function-name mana-salestailor \
  --region us-east-1 \
  --profile k.sato
```

## CI/CD

現在は手動デプロイのみ。GitHub Actionsは以下のみ：

- ✅ **Sync Source to S3** (`.github/workflows/sync-to-s3.yml`)
  - ソースコードのバックアップ用
  - デプロイ機能ではない

- ❌ **Vercelデプロイ** - 削除済み（使用しない）

## 関連ファイル

| ファイル | 用途 |
|---------|------|
| `deploy.sh` | メインデプロイスクリプト（全Lambda） |
| `deploy-salestailor.sh` | SalesTailor専用デプロイ |
| `api/env.json` | mana環境変数（gitignore） |
| `api/env.json.template` | 環境変数テンプレート |
| `.github/workflows/sync-to-s3.yml` | S3同期（デプロイではない） |

## 注意事項

1. **AWSプロファイル**: 必ず `--profile k.sato` を使用
2. **チャンネルマッピング**: `_codex/common/meta/slack/channels.yml` が正本
3. **project_id解決**: `channel-project-resolver.js` がチャンネルID→project_idを自動解決
4. **LLMは推測しない**: project_idはチャンネルマッピングから取得（LLMの推測は使わない）

## 最終更新

2025-12-16: Vercelデプロイを削除、Lambdaデプロイを正式化
