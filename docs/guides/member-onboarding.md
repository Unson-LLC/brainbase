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
```

### 2. セットアップスクリプト実行

```bash
./scripts/setup.sh
```

これで以下が自動設定される：
- `.env` ファイル生成（環境変数一式、`.gitignore`済み）
- `~/.brainbase/` ディレクトリ作成
- macOS: `~/Library/LaunchAgents/com.brainbase.ui.plist` 生成（launchd自動起動）

認証情報（JWT、Slack OAuth）はスクリプトに含まれているため、個別に受け取る必要はない。

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

新メンバーを追加する場合、管理者が `auth_grants` にメンバーを登録する：

```sql
-- 管理者がpsqlで実行
INSERT INTO auth_grants (slack_user_id, role, project_codes, clearance)
VALUES ('<新メンバーのSlack User ID>', 'member', ARRAY['brainbase','<project>'], ARRAY[]::text[]);
```

---

## トラブルシューティング

| 症状 | 原因 | 対処 |
|------|------|------|
| 「Login with Slack」押してもエラー | `./scripts/setup.sh` 未実行 | セットアップスクリプトを実行 |
| サーバーが起動しない | 環境変数が未設定 | `./scripts/setup.sh` を再実行 |
| Slackログイン後にwikiが空 | `auth_grants` にproject_codesが未設定 | 管理者にDB更新を依頼 |
| `wiki pull` でforbidden | 対象ページのプロジェクトがproject_codesに含まれていない | 管理者にproject_codes追加を依頼 |
| サーバー起動エラー | PostgreSQL接続情報が未設定 | `INFO_SSOT_DATABASE_URL` を確認 |
