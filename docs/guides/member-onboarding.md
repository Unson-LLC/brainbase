# メンバーオンボーディングガイド

**対象**: brainbase-unsonを新たに利用するUnsonメンバー
**更新日**: 2026-03-19

---

## デプロイメントモデル

brainbaseは**各メンバーがローカルでサーバーを起動し、共有のAWS PostgreSQLに接続する**分散アーキテクチャを採用している。

```
メンバーのPC（ローカル）
├── brainbase server (localhost:31013)   ← 各自が起動
│   └── → AWS Lightsail PostgreSQL       ← 共有DB（正本）
└── brainbase UI / CLI
    └── → localhost:31013                ← 自分のサーバーに接続
```

**重要**: 1台のサーバーを全員で共有するモデルではない。全メンバーが `localhost:31013` でアクセスする。

---

## セットアップ手順

### 1. リポジトリのクローン

```bash
git clone git@github.com:Unson-LLC/brainbase-unson.git brainbase
cd brainbase
npm install
```

### 2. 環境変数の設定

`~/.brainbase/` ディレクトリは初回起動時に自動作成される。

以下の環境変数を設定する。macOSではlaunchd plist、それ以外はシェルのexportで設定：

```bash
# ── 必須: DB接続 ──
export INFO_SSOT_DATABASE_URL="postgres://<user>:<pass>@<host>:5432/brainbase_ssot"

# ── 必須: 認証（Slack OAuth + JWT） ──
export BRAINBASE_JWT_SECRET="<管理者から受け取る>"
export SLACK_CLIENT_ID="<管理者から受け取る>"
export SLACK_CLIENT_SECRET="<管理者から受け取る>"

# ── 任意 ──
export ALLOW_INSECURE_SSOT_HEADERS=true   # 開発時のヘッダー認証を許可
export BRAINBASE_PUBLIC_URL=http://localhost:31013  # デフォルト値（通常変更不要）
```

**値の入手方法**: 管理者（佐藤）に依頼する。Slack App設定の `Client ID` / `Client Secret` とJWTシークレットを共有してもらう。

**macOS launchd の場合**: `~/Library/LaunchAgents/com.brainbase.ui.plist` の `EnvironmentVariables` セクションに上記の値を設定する。テンプレートは `common/ops/launchd/` を参照。

### 3. サーバー起動

```bash
# 手動起動
node server/server.js

# macOSの場合はlaunchdで管理（推奨）
# ~/Library/LaunchAgents/com.brainbase.ui.plist を設定
```

起動後、ブラウザで `http://localhost:31013` にアクセス。

### 4. 認証（Slackログイン）

1. UIを開く → **「Login with Slack」** ボタンをクリック
2. Slack OAuthフローが完了すると `~/.brainbase/tokens.json` が自動作成される
3. 以降、UIもCLIもこのトークンで認証される

**注意**: `brainbase auth login` は不要。UIのSlackログインだけで十分。

### 5. Wiki同期

```bash
# 権限内のwikiページをローカルにダウンロード
node cli/index.js wiki pull

# 差分確認
node cli/index.js wiki status

# 双方向同期
node cli/index.js wiki sync
```

wikiの内容は `wiki/` ディレクトリにMarkdownファイルとして保存される。
アクセスできるページは `auth_grants` テーブルの `project_codes` に基づいて決まる。

---

## 権限モデル

| レイヤー | 管理場所 | 内容 |
|---------|---------|------|
| 認証 | Slack OAuth → `auth_grants` テーブル | 誰がログインできるか |
| プロジェクトアクセス | `auth_grants.project_codes` | どのプロジェクトにアクセスできるか |
| Wikiアクセス | `wiki_pages.project_id` | どのwikiページが見えるか |

新メンバーを追加する場合、管理者が以下を実施：

1. **環境変数の共有**: `BRAINBASE_JWT_SECRET`, `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `INFO_SSOT_DATABASE_URL` を新メンバーに共有
2. **auth_grants登録**: 新メンバーの `slack_user_id` と `project_codes` をDBに登録

```sql
-- 管理者がpsqlで実行
INSERT INTO auth_grants (slack_user_id, role, project_codes, clearance)
VALUES ('<新メンバーのSlack User ID>', 'member', ARRAY['brainbase','<project>'], ARRAY[]::text[]);
```

---

## トラブルシューティング

| 症状 | 原因 | 対処 |
|------|------|------|
| 「Login with Slack」押してもエラー | `SLACK_CLIENT_ID`/`SLACK_CLIENT_SECRET` が未設定 | 管理者から値を受け取り環境変数に設定 |
| ログインボタンが表示されない | `BRAINBASE_JWT_SECRET` が未設定でサーバー起動失敗 | 環境変数を確認 |
| Slackログイン後にwikiが空 | `auth_grants` にproject_codesが未設定 | 管理者にDB更新を依頼 |
| `wiki pull` でforbidden | 対象ページのプロジェクトがproject_codesに含まれていない | 管理者にproject_codes追加を依頼 |
| サーバー起動エラー | PostgreSQL接続情報が未設定 | `INFO_SSOT_DATABASE_URL` を確認 |
