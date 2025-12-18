---
name: x-bookmarks-source
description: X(Twitter)ブックマークの取得・データ構造・活用ガイド。OAuth 2.0 PKCEでブックマーク取得し、引用ツイート・URLメタデータを含む完全なコンテキストを保存。情報収集・知見抽出時に使用。
---

# X Bookmarks取得ガイド

X(Twitter)ブックマークをOAuth 2.0 PKCEで取得し、引用ツイート・URLメタデータを含む完全なコンテキストとして保存・活用する運用ガイド。

## Instructions

### 1. ファイル構成

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

### 2. 取得コマンド

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

### 3. データ構造

```json
{
  "data": [
    {
      "id": "1234567890",
      "text": "ツイート本文...",
      "author_id": "9876543210",
      "created_at": "2025-12-01T10:00:00.000Z",
      "entities": {
        "urls": [
          {
            "url": "https://t.co/xxx",
            "expanded_url": "https://example.com/article",
            "title": "記事タイトル（X API提供）",
            "description": "記事の説明（X API提供）",
            "unwound_url": "https://example.com/article"
          }
        ]
      },
      "referenced_tweets": [
        {
          "type": "quoted",
          "id": "1111111111"
        }
      ]
    }
  ],
  "includes": {
    "users": [
      {
        "id": "9876543210",
        "name": "表示名",
        "username": "screen_name"
      }
    ],
    "tweets": [
      {
        "id": "1111111111",
        "text": "引用元ツイートの全文...",
        "author_id": "2222222222"
      }
    ],
    "url_metadata": {
      "https://example.com/article": {
        "title": "タイトル（スクレイピング補完）",
        "description": "説明",
        "final_url": "リダイレクト後URL"
      }
    }
  },
  "meta": {
    "result_count": 100
  }
}
```

### 4. コンテキストの構成要素

| 要素 | 場所 | 提供元 | 用途 |
|------|------|--------|------|
| ブックマーク本文 | `data[].text` | X API | メインコンテンツ |
| 投稿者情報 | `includes.users[]` | X API | 誰の投稿か |
| URLメタデータ | `data[].entities.urls[].title/description` | X API | リンク先の概要 |
| 引用元ツイート | `includes.tweets[]` | X API | 引用/RT元の全文 |
| 補完メタデータ | `includes.url_metadata{}` | スクリプト | X APIにない場合の補完 |

### 5. API制限

| 項目 | 制限値 |
|------|--------|
| 1リクエスト | 最大100件 |
| 取得上限 | 直近800件 |
| レート制限 | 50リクエスト/15分 |
| レート制限時 | 自動待機（x-rate-limit-reset使用） |

### 6. トークン管理

- **保存場所**: `_codex/common/ops/scripts/.x_oauth2_token.json`
- **自動リフレッシュ**: `refresh_token`で自動更新
- **有効期限**: アクセストークン2時間、リフレッシュトークン6ヶ月
- **再認証**: `--auth`オプションでブラウザ認証フロー

### 7. 活用パターン

**知見抽出**:
```bash
# latest.jsonを読み込んで分析
cat _codex/sources/global/x_bookmarks/cache/latest.json | jq '.data[] | {text, urls: .entities.urls}'
```

**特定トピック検索**:
```bash
# AIに関するブックマーク抽出
cat latest.json | jq '.data[] | select(.text | test("AI|LLM|GPT"; "i"))'
```

**引用元との紐付け**:
```bash
# 引用ツイートIDと本文を取得
cat latest.json | jq '{
  quoted: [.data[] | select(.referenced_tweets) | {id, text, quoted_id: .referenced_tweets[0].id}],
  originals: [.includes.tweets[] | {id, text}]
}'
```

## Examples

### 例1: 定期取得（週次）

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

### 例2: レート制限時の対応

レート制限エラー（429）が発生した場合:
1. スクリプトが自動的に`x-rate-limit-reset`ヘッダーを確認
2. リセット時刻まで待機（最大15分程度）
3. 自動リトライ（最大5回）

手動で確認する場合:
```bash
# stderrにログ出力されるので確認
/Users/ksato/workspace/.venv/bin/python \
  /Users/ksato/workspace/_codex/common/ops/scripts/x_oauth2.py \
  --bookmarks 10
# → "Rate limited. Waiting XXX seconds..."
```

### 例3: 特定URLのメタデータ確認

```bash
# X APIが提供するメタデータ（entities.urls内）
cat latest.json | jq '.data[0].entities.urls[] | {expanded_url, title, description}'

# スクリプトが補完したメタデータ
cat latest.json | jq '.includes.url_metadata | to_entries[0]'
```

### よくあるケース

**Q: ブックマークのURLからリンク先の内容がわからない**
→ `entities.urls[].title` と `entities.urls[].description` を確認。なければ `includes.url_metadata` を確認。

**Q: 引用ツイートの内容を見たい**
→ `data[].referenced_tweets[].id` を取得し、`includes.tweets[]` から該当IDを検索。

**Q: トークンが期限切れ**
→ 通常は自動リフレッシュ。失敗したら `--auth` で再認証。

---

このガイドに従うことで、Xブックマークを完全なコンテキスト付きで取得・活用できます。
