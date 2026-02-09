---
name: x-analytics-source
description: X(Twitter)アナリティクスの取得・データ構造・活用ガイド。OAuth 2.0 PKCEで自分のツイートとメトリクス（いいね・リツイート・インプレッション等）を取得。SNS運用の効果測定時に使用。
---

## Triggers

以下の状況で使用：
- 自分のツイートのエンゲージメント分析をしたいとき
- 過去の投稿のパフォーマンスを確認したいとき
- SNS運用の効果測定をしたいとき

# X Analytics取得ガイド

## ファイル構成

```
_codex/
├── common/ops/scripts/
│   ├── x_oauth2.py              # 取得スクリプト（--analytics オプション）
│   └── .x_oauth2_token.json     # トークン（.gitignore）
│
└── sources/global/x_analytics/
    ├── config.md                 # 取得設定
    └── cache/
        └── latest.json           # 最新取得データ
```

## 取得コマンド

```bash
# 基本取得（最新10件）
/Users/ksato/workspace/.venv/bin/python \
  /Users/ksato/workspace/_codex/common/ops/scripts/x_oauth2.py \
  --analytics 10

# JSON出力（最新100件）
/Users/ksato/workspace/.venv/bin/python \
  /Users/ksato/workspace/_codex/common/ops/scripts/x_oauth2.py \
  --analytics 100 --json > \
  /Users/ksato/workspace/_codex/sources/global/x_analytics/cache/latest.json

# 期間指定（2025年1月のツイート）
/Users/ksato/workspace/.venv/bin/python \
  /Users/ksato/workspace/_codex/common/ops/scripts/x_oauth2.py \
  --analytics 100 \
  --start-time 2025-01-01T00:00:00Z \
  --end-time 2025-01-31T23:59:59Z \
  --json > cache/2025-01.json
```

## データ構造

**主要要素**:
- `data[]`: ツイート一覧
- `data[].text`: ツイート本文
- `data[].created_at`: 投稿日時
- `data[].public_metrics`: 公開メトリクス
- `meta.total_metrics`: 全ツイートの合計メトリクス

**public_metrics構造**:
```json
{
  "retweet_count": 数値,      // リツイート数
  "reply_count": 数値,        // リプライ数
  "like_count": 数値,         // いいね数
  "quote_count": 数値,        // 引用ツイート数
  "bookmark_count": 数値,     // ブックマーク数（※有料プラン）
  "impression_count": 数値    // インプレッション数（※有料プラン）
}
```

## API制限

| 項目 | 制限値 |
|------|--------|
| 1リクエスト | 最大100件 |
| レート制限 | 900リクエスト/15分 |
| レート制限時 | 自動待機（x-rate-limit-reset使用） |

## 取得対象

- **含まれる**: 自分の投稿ツイート
- **除外される**: リツイート、リプライ（`exclude=retweets,replies`）

## API権限と取得可能メトリクス

| プラン | 取得可能メトリクス |
|--------|-------------------|
| Free（無料） | retweet_count, reply_count, like_count, quote_count |
| Basic以上（有料） | 上記 + bookmark_count, impression_count |

## 活用パターン

### エンゲージメント率分析

```bash
# latest.jsonを読み込んで分析
cat _codex/sources/global/x_analytics/cache/latest.json | \
  jq '.data[] | {
    date: .created_at[:10],
    engagement: (.public_metrics.like_count + .public_metrics.retweet_count),
    text: .text[:50]
  }'
```

### トップパフォーマンスツイート抽出

```bash
# いいね数トップ10
cat latest.json | \
  jq '.data | sort_by(-.public_metrics.like_count) | .[:10] | .[] | {
    likes: .public_metrics.like_count,
    text: .text[:80]
  }'
```

### 日別集計

```bash
# 日別のエンゲージメント集計
cat latest.json | \
  jq '.data | group_by(.created_at[:10]) | map({
    date: .[0].created_at[:10],
    tweets: length,
    total_likes: map(.public_metrics.like_count) | add,
    total_retweets: map(.public_metrics.retweet_count) | add
  })'
```

## 運用例

### 月次スナップショット

```bash
# 月初に前月のデータを保存
DATE=$(date -v-1m +%Y-%m)  # 前月（macOS）
/Users/ksato/workspace/.venv/bin/python \
  /Users/ksato/workspace/_codex/common/ops/scripts/x_oauth2.py \
  --analytics 100 \
  --start-time ${DATE}-01T00:00:00Z \
  --end-time ${DATE}-31T23:59:59Z \
  --json > /Users/ksato/workspace/_codex/sources/global/x_analytics/cache/${DATE}.json

# latest.jsonも更新
cp /Users/ksato/workspace/_codex/sources/global/x_analytics/cache/${DATE}.json \
   /Users/ksato/workspace/_codex/sources/global/x_analytics/cache/latest.json
```

### 合計メトリクスの確認

```bash
# JSON出力の meta.total_metrics から確認
cat latest.json | jq '.meta.total_metrics'

# 出力例:
# {
#   "retweet_count": 150,
#   "reply_count": 89,
#   "like_count": 1234,
#   "quote_count": 23,
#   "bookmark_count": 0,
#   "impression_count": 0
# }
```

## よくあるケース

**Q: impression_count が 0 になる**
→ 無料プラン（Free）の場合、impression_count は取得できません。Basic以上の有料プランが必要です。

**Q: 特定期間のツイートのみ取得したい**
→ `--start-time` と `--end-time` オプションを使用してください（ISO 8601形式）。

**Q: トークンが期限切れ**
→ 通常は自動リフレッシュ。失敗したら `--auth` で再認証。

**Q: レート制限エラー（429）**
→ スクリプトが自動的に`x-rate-limit-reset`ヘッダーを確認し、リセット時刻まで待機（最大15分）。自動リトライ最大5回。

## 認証

x_oauth2.py の OAuth 2.0 PKCE認証を使用（ブックマーク取得と共通）：

```bash
# 初回または再認証
/Users/ksato/workspace/.venv/bin/python \
  /Users/ksato/workspace/_codex/common/ops/scripts/x_oauth2.py \
  --auth
```

---
最終更新: 2025-12-30
