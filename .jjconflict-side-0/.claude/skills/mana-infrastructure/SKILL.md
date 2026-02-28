---
name: mana-infrastructure
description: manaのインフラ構成（Lambda + GitHub Actionsセルフホストランナー）の2層アーキテクチャを説明。スケジュール実行の調査時に参照。
---

# mana インフラ構成ガイド

## 目的

manaの2層インフラ構成を理解し、スケジュール実行やイベント処理の調査時に正しい場所を確認できるようにする。

## アーキテクチャ概要

```
┌─────────────────────────────────────────────────────────────┐
│                      mana インフラ構成                        │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────────┐    ┌─────────────────────────────┐ │
│  │   AWS Lambda        │    │  GitHub Actions             │ │
│  │   (オンデマンド)     │    │  (セルフホストランナー)      │ │
│  ├─────────────────────┤    ├─────────────────────────────┤ │
│  │ • Slackイベント受付  │    │ • スケジュール実行          │ │
│  │ • Webhook処理       │    │ • 日次処理 (mana日次処理)    │ │
│  │ • リアルタイム応答   │    │ • 週次処理 (mana週次処理)    │ │
│  └─────────────────────┘    │ • 各種M1〜M13ワークフロー   │ │
│                             └─────────────────────────────┘ │
│                                                             │
│  ローカルマシン: /Users/ksato/actions-runner/               │
│  LaunchAgent: actions.runner.Unson-LLC.ksato-mac.plist     │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## 2層構成の詳細

### Layer 1: AWS Lambda（オンデマンド処理）

**用途**: Slackイベントの受け付けとリアルタイム応答

**Lambda関数**:
- `mana` - メインワークスペース用
- `mana-salestailor` - SalesTailorワークスペース用
- `mana-techknight` - Tech Knightワークスペース用

**リージョン**: us-east-1

**デプロイ方法**:
```bash
cd /Users/ksato/workspace/projects/mana
./deploy.sh
```

**注意**: AWS EventBridgeのルール（`mana-daily-*`等）は**DISABLED**で使用されていない。

### Layer 2: GitHub Actions セルフホストランナー（スケジュール実行）

**用途**: 定期実行ジョブ（日次・週次処理）

**ランナー情報**:
- **パス**: `/Users/ksato/actions-runner/`
- **LaunchAgent**: `~/Library/LaunchAgents/actions.runner.Unson-LLC.ksato-mac.plist`
- **ワークディレクトリ**: `/Users/ksato/actions-runner/_work/`

**主要ワークフロー**:

| ワークフロー名 | 実行タイミング | 説明 |
|--------------|--------------|------|
| mana日次処理 | 毎日12:01 UTC (21:01 JST) | スプリント日次ログ更新 |
| mana週次処理 | 毎週木曜9:07 UTC | 新スプリント作成・週次サマリー |
| M1〜M13 | 各種スケジュール | プロジェクト別ダッシュボード等 |

## 確認コマンド

### ランナー稼働状況

```bash
# プロセス確認
ps aux | grep -i "actions-runner" | grep -v grep

# LaunchAgent確認
launchctl list | grep runner
```

### ワークフロー実行状況

```bash
# 日次処理の最近の実行
gh run list --repo Unson-LLC/mana --workflow "mana日次処理" --limit 5

# 週次処理の最近の実行
gh run list --repo Unson-LLC/mana --workflow "mana週次処理" --limit 5

# 全ワークフロー一覧
gh workflow list --repo Unson-LLC/mana
```

### Lambda関数確認

```bash
# 関数一覧
AWS_PROFILE=k.sato aws lambda list-functions --region us-east-1 --query 'Functions[?contains(FunctionName, `mana`)].[FunctionName]' --output table

# EventBridgeルール（参考：現在DISABLED）
AWS_PROFILE=k.sato aws events list-rules --region us-east-1 --query 'Rules[?contains(Name, `mana`)].[Name,State]' --output table
```

## よくある間違い

### ❌ 間違い: スケジュール実行がLambda + EventBridgeで動いていると思う

**理由**:
- `package.json`に「lambda」「aws」「serverless」がある
- `deploy.sh`がLambdaにデプロイする
- AWS EventBridgeに`mana-daily-*`ルールが存在する

**実際**:
- EventBridgeルールは全て**DISABLED**
- スケジュール実行は**GitHub Actions**

### ✅ 正しい確認手順

1. **スケジュール実行の調査** → GitHub Actions (`gh workflow list/run list`)
2. **Slackイベント処理の調査** → AWS Lambda (`aws lambda`)
3. **ランナーの問題** → LaunchAgent/プロセス確認

## トラブルシューティング

### 日次/週次処理が動いていない

```bash
# 1. ランナープロセス確認
ps aux | grep actions-runner

# 2. ワークフロー実行履歴確認
gh run list --repo Unson-LLC/mana --limit 10

# 3. 失敗したワークフローの詳細
gh run view <run-id> --repo Unson-LLC/mana --log-failed
```

### ランナーが停止している

```bash
# LaunchAgent再起動
launchctl unload ~/Library/LaunchAgents/actions.runner.Unson-LLC.ksato-mac.plist
launchctl load ~/Library/LaunchAgents/actions.runner.Unson-LLC.ksato-mac.plist

# ログ確認
tail -100 ~/Library/Logs/actions.runner.Unson-LLC.ksato-mac/stdout.log
```

## 関連ファイル

- **manaリポジトリ**: `/Users/ksato/workspace/projects/mana/`
- **デプロイスクリプト**: `/Users/ksato/workspace/projects/mana/deploy.sh`
- **ランナー設定**: `/Users/ksato/actions-runner/.runner`
- **ランナーログ**: `~/Library/Logs/actions.runner.Unson-LLC.ksato-mac/`
