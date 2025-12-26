# 小松原さんへの引き継ぎガイド

manaとbrainbaseの開発環境構築と開発の始め方をまとめました。

## 📦 リポジトリ

開発に必要な2つのリポジトリ:

| リポジトリ | URL | 用途 |
|-----------|-----|------|
| **brainbase** | https://github.com/Unson-LLC/brainbase | プロジェクト管理UI（OSS） |
| **mana** | https://github.com/Unson-LLC/mana | AI PM Agent（SaaS） |

## 🚀 クイックスタート

### 1. リポジトリのクローン

```bash
# 作業ディレクトリに移動
cd ~/workspace  # または任意のディレクトリ

# brainbaseをクローン
git clone https://github.com/Unson-LLC/brainbase.git
cd brainbase

# manaをクローン（別ディレクトリ）
cd ~/workspace
git clone https://github.com/Unson-LLC/mana.git
cd mana
```

### 2. brainbaseのセットアップ

```bash
cd ~/workspace/brainbase

# 依存パッケージのインストール
npm install

# 開発サーバー起動
npm start
```

ブラウザで `http://localhost:3000` を開いて動作確認。

### 3. manaのセットアップ

詳細は `mana/docs/SETUP.md` を参照してください。

```bash
cd ~/workspace/mana

# Lambda関数用パッケージのインストール
cd api
npm install

# 環境変数の設定
cp .env.example ~/workspace/.env
# .envファイルを編集して必要な環境変数を設定

# ローカルテスト実行（dry-run）
cd ~/workspace/mana
node scripts/mana-daily-v2.js --dry-run --project=salestailor
```

## 📁 重要なディレクトリ構成

### brainbase (このリポジトリ)

```
brainbase/
├── public/              # フロントエンドUI
│   ├── index.html
│   ├── modules/         # ドメインサービス
│   └── style.css
├── server/              # バックエンド（Node.js）
├── _codex-sample/       # サンプルデータ（開発用）
│   ├── projects/
│   ├── orgs/
│   └── common/meta/
├── .gitignore           # _codex/は除外されている
└── package.json
```

**重要**: `_codex/` ディレクトリは佐藤さんの本番データで、このリポジトリには含まれていません。開発時は `_codex-sample/` を参照してください。

### mana

```
mana/
├── api/                 # Lambda関数本体
│   ├── index.js         # Slackボット
│   ├── daily-log-generator.js
│   └── airtable-milestone-client.js
├── scripts/             # 日次・週次処理スクリプト
│   ├── mana-daily-v2.js
│   └── mana-weekly.js
├── docs/                # ドキュメント
│   ├── SETUP.md         # セットアップガイド
│   ├── ARCHITECTURE.md  # アーキテクチャ
│   └── API_REFERENCE.md # API仕様
└── .github/workflows/   # GitHub Actions
```

## 🔑 環境変数について

manaの動作には環境変数が必要です。詳細は `mana/docs/SETUP.md` を参照してください。

**最低限必要な環境変数**（`~/workspace/.env` に設定）:

```bash
# Slack
SLACK_BOT_TOKEN=xoxb-...
SLACK_SIGNING_SECRET=...
SLACK_BOT_ID=...

# Airtable
AIRTABLE_API_KEY=pat...

# AWS Bedrock
BEDROCK_REGION=us-east-1
BEDROCK_MODEL_ID=anthropic.claude-3-5-sonnet-20241022-v2:0
BEDROCK_ACCESS_KEY_ID=...
BEDROCK_SECRET_ACCESS_KEY=...

# GitHub
GITHUB_TOKEN=ghp_...
```

**注意**: 環境変数の実際の値は佐藤さんから別途共有されます。

## 💻 開発の始め方

### brainbaseの開発

1. `npm start` で開発サーバー起動
2. ブラウザで `http://localhost:3000` を開く
3. `_codex-sample/` のデータを使って動作確認
4. コード変更は自動リロードされる

**主な開発ファイル**:
- UI: `public/index.html`, `public/style.css`
- ドメインサービス: `public/modules/domain/`
- セッション管理: `public/modules/session-indicators.js`

### manaの開発

1. **ローカルテスト**:
```bash
# dry-runで実行（実際の書き込みなし）
node scripts/mana-daily-v2.js --dry-run --project=salestailor
```

2. **Lambda関数のテスト**:
```bash
cd api
node index.js
```

3. **変更後のデプロイ**:
```bash
cd api
./deploy.sh  # 3つのLambda関数に同時デプロイ
```

## 📚 参考ドキュメント

| ドキュメント | 内容 |
|-------------|------|
| `mana/docs/SETUP.md` | manaの詳細セットアップ手順 |
| `mana/docs/ARCHITECTURE.md` | manaのアーキテクチャ解説 |
| `mana/docs/API_REFERENCE.md` | 各モジュールの関数仕様 |
| `mana/README.md` | manaの概要と機能説明 |
| `brainbase/_codex-sample/` | サンプルデータの構造 |

## ⚠️ 注意事項

### 1. _codex について

- `_codex/` は佐藤さんの本番データで、初期段階では共有されません
- 開発時は `_codex-sample/` のサンプルデータを使用してください
- 将来的にはプロジェクト固有のcodexが共有される予定です

### 2. 環境変数の管理

- `.env` ファイルはGitにコミットしないでください
- API Key、トークンなどの秘密情報は厳重に管理してください
- Lambda環境変数もAWS Consoleから設定が必要です

### 3. デプロイ

- manaのデプロイ前に必ずローカルテストを実行してください
- `deploy.sh` は3つのLambda関数（production, salestailor-prod, techknight-prod）に同時デプロイします
- デプロイ後はCloudWatch Logsで動作確認してください

### 4. GitHub Actions

- mana-daily: 毎日21:00 JST実行（日次ログ生成）
- mana-weekly: 毎週金曜18:00 JST実行（週次振り返り）
- ワークフローのSecretsは既に設定済みですが、必要に応じて確認してください

## 🤝 サポート

わからないことがあれば、以下にご連絡ください:

- **Slack**: 佐藤さんにDM
- **GitHub Issues**: https://github.com/Unson-LLC/mana/issues
- **メール**: 佐藤さんのメールアドレス

## 🎯 最初にやること

1. [ ] 両リポジトリをクローン
2. [ ] brainbaseの開発サーバーを起動して動作確認
3. [ ] manaの環境変数を設定（佐藤さんから共有された値を使用）
4. [ ] mana-daily-v2.jsをdry-runモードで実行してみる
5. [ ] わからないことがあれば質問する

---

最終更新: 2025-12-26
作成者: 佐藤圭吾
