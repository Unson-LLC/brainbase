# メンバーオンボーディングガイド

**対象**: brainbase-unsonを新たに利用するUnsonメンバー
**更新日**: 2026-03-20

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

### 1. インストール

```bash
git clone git@github.com:Unson-LLC/brainbase-unson.git
cd brainbase-unson
npm run setup
```

これだけで以下が全自動で実行される：
- `npm install`（依存パッケージ）
- MCP Server依存インストール（brainbase / nocodb / jibble）
- `gogcli` インストール（Google Suite CLI、Homebrew経由）
- `.env` 生成（認証情報・DB接続含む）
- macOS: launchd plist生成 + サーバー自動起動
- ヘルスチェック

### セットアップ後に使えるツール

| ツール | 用途 | 確認コマンド |
|--------|------|-------------|
| brainbase MCP | brainbase Graph（人物・組織・プロジェクト・顧客・用語・ADR等）への問い合わせ窓口 → [詳細](#brainbase-mcpbrainbase-graphとは) | Claude Codeで自動読み込み |
| nocodb MCP | タスク・スプリント・マイルストーン管理 | Claude Codeで自動読み込み |
| jibble MCP | 勤怠・工数管理 | Claude Codeで自動読み込み |
| gogcli | Google Suite CLI（Gmail/Calendar/Drive等） | `gog --version` |

### 2. 認証（Slackログイン）

1. UIを開く → **「Login with Slack」** ボタンをクリック
2. Slack OAuthフローが完了すると `~/.brainbase/tokens.json` が自動作成される
3. 以降、UIもCLIもClaude Code（brainbase MCP経由）も、このトークンで認証される

**注意**: `brainbase auth login` は不要。UIのSlackログインだけで十分。

---

## brainbase MCP（brainbase Graph）とは

Slackログイン後、 **Claude Code から brainbase Graph SSOT に問い合わせる窓口** が自動的に有効になる。 これが brainbase MCP。

### 何ができる

`~/.brainbase/tokens.json` のトークンを使い、 Claude Code が `mcp__brainbase__*` ツール経由で Graph に質問できるようになる。 自分が `auth_grants.project_codes` で許可されている範囲のエンティティだけが返る。

| 聞きたいこと | Claude Code への聞き方の例 | 内部で叩かれるツール |
|---|---|---|
| 「川合さんって誰？ どの会社・プロジェクトに関わってる？」 | そのまま聞く | `get_context` / `search` |
| 「雲孫の進行中プロジェクト一覧」 | そのまま聞く | `list_entities(type=project)` |
| 「『MaC』って用語の定義は？」 | そのまま聞く | `list_entities(type=glossary_term)` |
| 「直近のADR（意思決定）は？」 | そのまま聞く | `list_entities(type=decision)` |
| 「顧客◯◯の現状ステータスは？」 | そのまま聞く | `get_context(scope=crm)` |
| 「brainbase の哲学・前提を教えて」 | そのまま聞く | `philosophy_context` 自動付与 |

### Graphに格納されている主なエンティティ（14 type）

| type | 内容 |
|---|---|
| `project` | プロダクト（zeims / salestailor / brainbase / baao 等） |
| `person` | 社内・関係者 |
| `org` | 組織・法人 |
| `customer` | 顧客（企業） |
| `partner` | 外部パートナー企業 |
| `contact` | 個人連絡先（CRM） |
| `app` | アプリ（brainbase-ui / mana 等） |
| `brand` | ブランドガイド |
| `frame` | 運用フレームワーク（UNSON OS 等） |
| `philosophy` | 思想・哲学（Graph操作前にagent/toolへ注入される判断前提） |
| `glossary_term` | 用語集 |
| `decision` | 意思決定ログ（ADR） |
| `story` | 開発ストーリー |
| `raci_assignment` | RACI 割当 |

### なぜこれが効くのか

- 議事録や Notion・Slack のメモは話者推測や AI 要約のせいで **固有名詞が誤認されやすい**（例: 正「川合 秀明」→ 誤「河合 英明」）
- brainbase Graph は SSOT（Single Source of Truth）であり、 `aliases` を持つので別表記からも逆引きできる
- Claude Code は Graph を一次情報として扱うため、 **「Slackに書いてあった気がする」 ベースの推測ではなく確定情報で回答する**

### 使う前のチェック

```bash
# トークン存在確認
ls -la ~/.brainbase/tokens.json   # → -rw------- (600)

# Graph直接叩いて確認（任意）
TOKEN=$(cat ~/.brainbase/tokens.json | jq -r .access_token)
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://graph.brain-base.work/api/info/graph/entities?type=project&limit=10" | jq
```

トークンがない場合は UI で Slack ログインをやり直す。 期限切れなら自動リフレッシュされるが、 401 が出たら再ログイン。

### 3. Google Calendar連携（任意）

タイムラインで Google Calendar を出したいメンバーは、各自の Mac で `gog` を認証する。

```bash
gog auth credentials <path-to-credentials.json>
gog auth add <your-email> --services calendar
```

- brainbase は `gog` の default account を使う
- Google secrets や refresh token を team 配布する必要はない
- 予定取得対象を変えたい場合だけ `.env` に `BRAINBASE_GOOGLE_CALENDAR_IDS=primary,<calendarId>` を追加する

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
