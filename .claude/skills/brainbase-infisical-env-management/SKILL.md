---
name: brainbase-infisical-env-management
description: brainbaseで環境変数・secret・.env・本番設定を扱う時に、Infisicalを正規の管理経路として使うためのSkill。secret値を表示せず、登録・取得・移行・実行時注入を安全に行う。
---

# brainbase Infisical Env Management

## Triggers

以下の作業では必ずこのSkillを先に読む。

- brainbase の環境変数、`.env`、secret、credential、API key、DB URL、JWT secret、OAuth secret を扱う
- `scripts/setup.sh`、launchd plist、Docker Compose、Lightsail、Graph API、NocoDB、Honcho の env を変更する
- secret を登録・取得・棚卸し・ローテーション・移行する
- 「brainbaseを通す」「brainbaseで実行する」「本番 env を使う」作業をする

## 原則

- brainbase の secret 管理は Infisical を正規経路にする。
- secret 値はチャット、ログ、docs、git diff、標準出力に出さない。
- `.env` は実行時の一時投影または bootstrap 用に限定し、正本にしない。
- 既存サービスの runtime env 切替は、明示依頼があるまで行わない。
- `/opt/infisical/.env` は Infisical 自身の secret zero であり、アプリ用secret置き場として使わない。
- `ENCRYPTION_KEY` は Infisical 内では管理できない。オフラインの管理経路でバックアップ済みであることを確認する。

## 現在のInfisical構成

| 項目 | 値 |
|---|---|
| URL | `https://infisical.unson.jp` |
| Lightsail | `brainbase-nocodb` (`176.34.20.239`) |
| Server path | `/opt/infisical` |
| Compose project | `infisical` |
| Bootstrap env | `/opt/infisical/.env` |
| Local bootstrap backup | `~/.brainbase/infisical/brainbase-nocodb.env` |
| Import file | `~/.brainbase/infisical/imports/brainbase-production.env` |
| Server inventory | `/opt/infisical/secrets-inventory.md` |

## 現在の登録済みProject

| Project | Environment | Path | 用途 |
|---|---|---|---|
| `brainbase` | `production` | `/` | local launchd / Graph API の root secrets |
| `brainbase` | `production` | `/lightsail-main` | Lightsail main compose (`/home/ubuntu`) の NocoDB/Postgres/SMTP secrets |
| `brainbase` | `production` | `/honcho` | Lightsail Honcho compose (`/home/ubuntu/honcho`) の API/deriver secrets |
| `mana-app` | `production` | `/lambda/<function>` | Mana AWS Lambda 環境変数の登録先。runtime source は `aws.lambda.environment_variables` |
| `unson` | `dev` / `staging` / `prod` | `/` | Unson company-wide shared secrets。2026-04-28作成、値は未登録 |
| `dialogai-app` | `dev` / `staging` / `prod` | `/` | DialogAI project secrets。Graph project code は `ncom`。2026-04-28に `ncom-app` からrename、値は未登録 |
| `zeims` | `dev` / `staging` / `prod` | `/` | Zeims product secrets。Unson配下。2026-04-28作成、値は未登録 |
| `salestailor` | `development` | `/` | SalesTailor local/dev |
| `salestailor` | `preview` | `/` | SalesTailor preview/Vercel staging |
| `salestailor` | `production` | `/` | SalesTailor production |
| `techknight` | `dev` / `staging` / `prod` | `/` | TechKnight company-wide / SmartFront shared secrets。2026-04-28作成、値は未登録 |
| `aitle` | `dev` / `staging` / `prod` | `/` | Aitle product secrets。2026-04-28作成、値は未登録。Graph project entity は未作成だが app/brand から参照あり |
| `smartfront` | `dev` / `staging` / `prod` | `/` | SmartFront product secrets。TechKnight配下。2026-04-28作成、値は未登録 |
| `baao-app` | `dev` / `staging` / `prod` | `/` | BAAO company-wide shared secrets。2026-04-28作成、値は未登録 |
| `senpainurse` | `dev` / `staging` / `prod` | `/web` | センパイナース product secrets。TechKnight配下。2026-04-28作成、値は未登録 |

## 現在のruntime投影

| 対象 | 投影ファイル | 起動側の参照 |
|---|---|---|
| local brainbase launchd | `~/.brainbase/runtime-env/brainbase-production.env` | `BRAINBASE_ENV_PATH` in `~/Library/LaunchAgents/com.brainbase.ui.plist` |
| Lightsail Graph API | `/opt/graph-api/.env.infisical` | `/opt/graph-api/.env` and `.env.graph-api` symlink |
| Lightsail main compose | `/home/ubuntu/.env.infisical` | `/home/ubuntu/.env` symlink |
| Lightsail Honcho | `/home/ubuntu/honcho/.env.infisical` | `/home/ubuntu/honcho/.env.honcho` symlink |

Graph SSOT:
- `app_brainbase.secret_management.provider = infisical`
- `app_brainbase -> app_infisical` has `uses_secret_store`
- `app_mana.secret_management.provider = infisical`
- `app_mana -> app_infisical` has `uses_secret_store`
- Graphにはsecret値を入れず、`project_slug` / `env` / `path` / key count / hash / runtime projectionだけを書く。

## 標準フロー

### 1. 状態確認

値を表示しない確認だけを行う。

```bash
curl -sS https://infisical.unson.jp/api/status | jq

ssh -i ~/.ssh/lightsail-brainbase.pem ubuntu@176.34.20.239 \
  'cd /opt/infisical && docker compose -p infisical ps'
```

### 2. CLIログイン

Infisical CLI がない場合は公式 release binary を使う。Homebrew は Xcode Command Line Tools の状態で失敗する場合がある。

```bash
~/.local/bin/infisical --version
~/.local/bin/infisical login --domain https://infisical.unson.jp
```

ブラウザcallbackが戻らない場合は、ブラウザに表示されたtokenをCLIの `Paste your browser token here:` に貼る。

### 3. Project / Environment

初回はUIで以下を作る。

```text
Project: brainbase
Environment: production
```

CLIで操作する作業ディレクトリは、必要に応じて `infisical init` で `brainbase` project に紐付ける。生成される設定ファイルにsecret値を入れない。

### 4. 既存secretの登録

importファイルは値を含むため、表示しない。

```bash
chmod 600 ~/.brainbase/infisical/imports/brainbase-production.env

~/.local/bin/infisical secrets set \
  --domain https://infisical.unson.jp \
  --env production \
  --file ~/.brainbase/infisical/imports/brainbase-production.env
```

登録後の確認はキー名だけを見る。

```bash
~/.local/bin/infisical secrets \
  --domain https://infisical.unson.jp \
  --env production \
  -o json | jq -r 'if type == "array" then .[].key else (.secrets // [])[].key end' | sort
```

## 実行時注入パターン

### Slack MCP

Slack MCP は人間の Infisical CLI ログイン状態に依存させない。3ワークスペース（`salestailor` / `unson` / `techknight`）の MCP は専用の Machine Identity / read-only token を使い、起動前に health check で fail loud する。

```bash
install -d -m 700 ~/.brainbase/runtime-env
# Universal Auth の Client ID / Client Secret は表示しない経路で投入する
chmod 600 ~/.brainbase/runtime-env/slack-mcp.universal-auth.env

cd /Users/ksato/workspace/code/brainbase
scripts/check-slack-mcp-health.sh
```

運用:

- auth file: `~/.brainbase/runtime-env/slack-mcp.universal-auth.env`
- token file fallback: `~/.brainbase/runtime-env/slack-mcp.infisical-token`
- project: `unson`
- env: `prod`
- default path: `/`（`/mcp/slack` へ移したら `SLACK_MCP_INFISICAL_PATH=/mcp/slack` を設定する）
- 必須key名: `SLACK_MCP_XOXC_<WORKSPACE>` / `SLACK_MCP_XOXD_<WORKSPACE>`
- `SLACK_MCP_UNAVAILABLE` は「Slack 0件」ではなく「Slack未確認」として扱う
- 人間ログイン fallback は `SLACK_MCP_ALLOW_USER_INFISICAL=1` の明示時だけ許可する

auth file の形式:

```dotenv
INFISICAL_UNIVERSAL_AUTH_CLIENT_ID=...
INFISICAL_UNIVERSAL_AUTH_CLIENT_SECRET=...
```

### ローカルbrainbase実行

既存 `.env` にsecretを直書きしない。Infisicalから注入して起動する。

```bash
~/.local/bin/infisical run \
  --domain https://infisical.unson.jp \
  --env production \
  -- npm run start
```

### ファイル投影が必要な場合

どうしても `.env` 形式が必要なツールでは、git管理外の一時ファイルに投影する。

```bash
install -d -m 700 ~/.brainbase/runtime-env

~/.local/bin/infisical export \
  --domain https://infisical.unson.jp \
  --env production \
  --format dotenv \
  > ~/.brainbase/runtime-env/brainbase-production.env

chmod 600 ~/.brainbase/runtime-env/brainbase-production.env
```

## 移行ルール

1. 既存secretをInfisicalに登録する。
2. 登録漏れをキー名だけで確認する。
3. 1サービスだけ選んで `infisical run` または投影ファイルで起動を切り替える。
4. health check とログを確認する。
5. 問題なければ次のサービスへ進む。

切替順の推奨:

```text
local brainbase → Graph API → NocoDB → Honcho → その他
```

## 禁止

- `cat .env`、`docker inspect`、`printenv` の結果をそのまま表示する
- secret値をdocsやSKILL.mdに書く
- `/opt/infisical/.env` の値をアプリsecretとして再利用する
- 既存本番サービスを一括でInfisical読み込みに切り替える
- importファイルをrepo配下に置く
- `scripts/setup.sh` に固定のJWT secretやOAuth secretを書く

## 値を出さない確認例

```bash
# キー名だけ確認
awk -F= '/^[A-Z0-9_]+=/{print $1}' ~/.brainbase/infisical/imports/brainbase-production.env | sort

# Docker envもキー名だけ確認
ssh -i ~/.ssh/lightsail-brainbase.pem ubuntu@176.34.20.239 \
  'docker inspect brainbase-graph-api --format "{{range .Config.Env}}{{println .}}{{end}}" | sed -E "s/=.*$/=***/" | sort'
```

## 失敗時の扱い

- Infisical UI/API が落ちても、既存サービスはまだ切替前なら影響しない。
- Infisical composeだけ戻す場合:

```bash
ssh -i ~/.ssh/lightsail-brainbase.pem ubuntu@176.34.20.239 \
  'cd /opt/infisical && docker compose -p infisical ps && docker compose -p infisical logs --tail 100 backend'
```

- 破壊的操作が必要な場合は、Lightsail snapshot `brainbase-nocodb-before-infisical-20260427-115333` の有無を確認してから行う。
