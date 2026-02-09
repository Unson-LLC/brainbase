---
name: x-bookmarks-source
description: X(Twitter)ブックマークの取得・データ構造・活用ガイド。OAuth 2.0 PKCEでブックマーク取得し、引用ツイート・URLメタデータを含む完全なコンテキストを保存。情報収集・知見抽出時に使用。
---

## Triggers

以下の状況で使用：
- Xブックマークから知見を抽出したいとき
- ブックマークデータの取得・更新方法を確認したいとき
- 引用ツイートやURLメタデータの取得方法を知りたいとき

# X Bookmarks取得ガイド

## ファイル構成

```
_codex/
├── common/ops/scripts/
│   ├── x_oauth2.py              # 取得スクリプト
│   └── .x_oauth2_token.json     # トークン（.gitignore）
│
└── sources/global/x_bookmarks/
    ├── config.md                 # 取得設定
    └── cache/
        └── latest.json           # 最新取得データ
```

## 取得コマンド

```bash
# 基本取得（最新100件）
/Users/ksato/workspace/.venv/bin/python \
  /Users/ksato/workspace/_codex/common/ops/scripts/x_oauth2.py \
  --bookmarks 100 --json > \
  /Users/ksato/workspace/_codex/sources/global/x_bookmarks/cache/latest.json

# 少数テスト（10件）
/Users/ksato/workspace/.venv/bin/python \
  /Users/ksato/workspace/_codex/common/ops/scripts/x_oauth2.py \
  --bookmarks 10

# 再認証（トークン期限切れ時）
/Users/ksato/workspace/.venv/bin/python \
  /Users/ksato/workspace/_codex/common/ops/scripts/x_oauth2.py \
  --auth
```

## データ構造

**主要要素**:
- `data[]`: ブックマークツイート本文
- `data[].entities.urls[]`: URLメタデータ（title/description含む）
- `data[].referenced_tweets[]`: 引用ツイートID
- `includes.users[]`: 投稿者情報
- `includes.tweets[]`: 引用元ツイート全文
- `includes.url_metadata{}`: X APIにない場合の補完メタデータ

**コンテキスト構成**:
| 要素 | 場所 | 用途 |
|------|------|------|
| ブックマーク本文 | `data[].text` | メインコンテンツ |
| URLメタデータ | `data[].entities.urls[].title/description` | リンク先の概要 |
| 引用元ツイート | `includes.tweets[]` | 引用/RT元の全文 |
| 投稿者情報 | `includes.users[]` | 誰の投稿か |

## API制限

| 項目 | 制限値 |
|------|--------|
| 1リクエスト | 最大100件 |
| 取得上限 | 直近800件 |
| レート制限 | 50リクエスト/15分 |
| レート制限時 | 自動待機（x-rate-limit-reset使用） |

## トークン管理

- **保存場所**: `_codex/common/ops/scripts/.x_oauth2_token.json`
- **自動リフレッシュ**: `refresh_token`で自動更新
- **有効期限**: アクセストークン2時間、リフレッシュトークン6ヶ月
- **再認証**: `--auth`オプションでブラウザ認証フロー

## 活用パターン

### 知見抽出

```bash
# latest.jsonを読み込んで分析
cat _codex/sources/global/x_bookmarks/cache/latest.json | jq '.data[] | {text, urls: .entities.urls}'
```

### 特定トピック検索

```bash
# AIに関するブックマーク抽出
cat latest.json | jq '.data[] | select(.text | test("AI|LLM|GPT"; "i"))'
```

### 引用元との紐付け

```bash
# 引用ツイートIDと本文を取得
cat latest.json | jq '{
  quoted: [.data[] | select(.referenced_tweets) | {id, text, quoted_id: .referenced_tweets[0].id}],
  originals: [.includes.tweets[] | {id, text}]
}'
```

## 運用例

### 定期取得（週次スナップショット）

```bash
# 日付付きスナップショット保存
DATE=$(date +%Y-%m-%d)
/Users/ksato/workspace/.venv/bin/python \
  /Users/ksato/workspace/_codex/common/ops/scripts/x_oauth2.py \
  --bookmarks 100 --json > \
  /Users/ksato/workspace/_codex/sources/global/x_bookmarks/cache/${DATE}.json

# latest.jsonも更新
cp /Users/ksato/workspace/_codex/sources/global/x_bookmarks/cache/${DATE}.json \
   /Users/ksato/workspace/_codex/sources/global/x_bookmarks/cache/latest.json
```

### URLメタデータ確認

```bash
# X APIが提供するメタデータ（entities.urls内）
cat latest.json | jq '.data[0].entities.urls[] | {expanded_url, title, description}'

# スクリプトが補完したメタデータ
cat latest.json | jq '.includes.url_metadata | to_entries[0]'
```

## よくあるケース

**Q: ブックマークのURLからリンク先の内容がわからない**
→ `entities.urls[].title` と `entities.urls[].description` を確認。なければ `includes.url_metadata` を確認。

**Q: 引用ツイートの内容を見たい**
→ `data[].referenced_tweets[].id` を取得し、`includes.tweets[]` から該当IDを検索。

**Q: トークンが期限切れ**
→ 通常は自動リフレッシュ。失敗したら `--auth` で再認証。

**Q: レート制限エラー（429）**
→ スクリプトが自動的に`x-rate-limit-reset`ヘッダーを確認し、リセット時刻まで待機（最大15分）。自動リトライ最大5回。

---
最終更新: 2025-12-19
