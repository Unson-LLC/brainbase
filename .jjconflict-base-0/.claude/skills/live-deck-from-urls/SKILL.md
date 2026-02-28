---
name: live-deck-from-urls
description: XのURLリストからライブ・登壇資料を自動生成。ツイート内容取得 + 直近1週間のバズ追加調査まで一発でこなす。
---

## Triggers

以下の状況で使用：
- 「今日のライブで使う資料を作りたい」
- 「XのURLから登壇ネタをまとめて」
- 「ライブ用のXまとめを作って」

---

## Instructions

### 前提
- `.env`: `/Users/ksato/workspace/.env`（`X_BEARER_TOKEN` と `TWITTERAPI_IO_KEY` が必須）
- 出力先: `common/ops/live/YYYY-MM-DD-live-materials.md`
- Python環境: `/Users/ksato/workspace/.venv/bin/python`

---

## Phase 1: ツイート内容を一括取得

URLリストからツイートIDを抽出し、Tweepy v2 APIで内容を一括取得する。

```python
#!/Users/ksato/workspace/.venv/bin/python
import os, tweepy
from pathlib import Path

# .env読み込み
with open('/Users/ksato/workspace/.env') as f:
    for line in f:
        line = line.strip()
        if line and not line.startswith('#') and '=' in line:
            k, v = line.split('=', 1)
            os.environ[k] = v

client = tweepy.Client(bearer_token=os.environ['X_BEARER_TOKEN'])

# ユーザーから受け取ったURLリストからIDを抽出
urls = [
    # ここにURLを列挙
]
tweet_ids = [u.split('/status/')[1].split('?')[0] for u in urls]

result = client.get_tweets(
    ids=tweet_ids,
    expansions=['author_id'],
    user_fields=['name', 'username'],
    tweet_fields=['text', 'created_at', 'public_metrics']
)

users = {u.id: u for u in (result.includes.get('users') or [])}
for tweet in (result.data or []):
    user = users.get(tweet.author_id)
    m = tweet.public_metrics or {}
    print(f"@{user.username} / {user.name}")
    print(f"♥{m.get('like_count',0)} RT{m.get('retweet_count',0)}")
    print(tweet.text[:300])
    print(f"https://x.com/{user.username}/status/{tweet.id}")
    print()
```

**注意**: `result.data` の順序は投稿時刻順ではなくAPI返却順。エンゲージメント順にソートするなら `public_metrics.like_count` でソート。

---

## Phase 2: 直近1週間のバズ追加調査

twitterapi.ioで `since:YYYY-MM-DD` を付けて検索。日付は今日から7日前を使う。

```python
#!/Users/ksato/workspace/.venv/bin/python
import os, requests
from datetime import datetime, timedelta

with open('/Users/ksato/workspace/.env') as f:
    for line in f:
        line = line.strip()
        if line and not line.startswith('#') and '=' in line:
            k, v = line.split('=', 1)
            os.environ[k] = v

API_KEY = os.environ['TWITTERAPI_IO_KEY']
since = (datetime.now() - timedelta(days=7)).strftime('%Y-%m-%d')

def search(query, min_eng=300):
    params = {"query": f"{query} since:{since}", "queryType": "Top"}
    r = requests.get(
        "https://api.twitterapi.io/twitter/tweet/advanced_search",
        params=params,
        headers={"X-API-Key": API_KEY},
        timeout=30
    )
    tweets = r.json().get('tweets', [])
    results = []
    for t in tweets:
        likes = t.get('likeCount', 0) or 0
        rts = t.get('retweetCount', 0) or 0
        if likes + rts < min_eng:
            continue
        author = t.get('author', {}) or {}
        results.append({
            'username': author.get('userName', ''),
            'name': author.get('name', ''),
            'text': t.get('text', '')[:300],
            'likes': likes, 'rts': rts,
            'eng': likes + rts,
            'id': t.get('id', ''),
            'created_at': t.get('createdAt', ''),
            'url': f"https://x.com/{author.get('userName','')}/status/{t.get('id','')}",
        })
    return sorted(results, key=lambda x: x['eng'], reverse=True)[:10]
```

**クエリ例（テーマに合わせて変える）**:
- `"生成AI"` → 生成AI全般
- `"Claude ChatGPT"` → 主要LLM動向
- `"AIエージェント MCP"` → エージェント技術
- `"AI 自動化 業務"` → 業務活用

**フィルタ基準**:
- `min_eng=300`（いいね+RT合計300以上）
- 日本語コンテンツを優先
- 技術よりすぎるもの・古いニュースは除外して、ライブ向きのネタを選ぶ
- 既存URLリストのIDを除外して重複を防ぐ

---

## Phase 3: 資料Markdownを生成

出力先: `common/ops/live/YYYY-MM-DD-live-materials.md`

```markdown
# 無料ライブ資料｜{テーマ}

**日付**: YYYY-MM-DD
**テーマ**: {テーマ}

---

## 概要

{2-3行の概要}

---

## 注目ポスト一覧

### 1. {タイトル}
**@{username} / {name}**
> {本文の要約 2-3行}

♥{likes} RT{rts} | {url}

---
...

## 追加候補（直近1週間 since:{date} Xから収集）

> ライブで使うものをここから選んで

### A. {タイトル}
**@{username} / {name}** ｜ {投稿日}
> {本文の要約}

♥{likes} RT{rts} | {url}

---
...

## ライブ構成案

1. **オープニング** - 今日話すこと・なぜ今AIが重要か（3分）
2. **最新動向ピックアップ** - 上記ポストから注目トピックを紹介（15分）
3. **実践ポイント** - 今日から使えるアクション（7分）
4. **Q&A** （5分）
```

---

## 実行チェックリスト

- [ ] URLリストをユーザーから受け取る
- [ ] Phase 1: Tweepy v2で全URLのツイート内容を取得
- [ ] ライブのテーマを確認（未指定なら内容から推定）
- [ ] Phase 2: twitterapi.ioで直近1週間バズ検索（2-3クエリ並列）
- [ ] 既存URLを除外して重複排除
- [ ] 日本語コンテンツ優先・ライブ向きネタに絞る
- [ ] Phase 3: Markdownで資料生成・保存

---

## 落とし穴メモ

- **WebFetch/chrome-devtoolsは使わない**: XはJS必須なので取得不可。必ずAPIを使う
- **.envの場所**: `code/brainbase/.env` ではなく `/Users/ksato/workspace/.env` にある
- **フィールド名注意**: twitterapi.ioは `likeCount` / `retweetCount`（camelCase・トップレベル）。Tweepy v2は `public_metrics.like_count`（snake_case）
- **since:フィルタ**: queryパラメータに `since:YYYY-MM-DD` を含めるだけでOK
- **古いバズが混入しやすい**: `queryType: "Top"` は時系列ではなくエンゲージメント順。必ず `since:` で期間を絞ること
