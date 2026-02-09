# Phase 1: Buzz Discovery Subagent

## 役割

海外のバズ投稿を発見し、キュレーション候補をリストアップする

## 装備Skills

なし（スクリプト実行のみ）

## 入力

- キーワード（オプション）: 指定時はそのキーワードで検索
- 空欄時: config.py のSEARCH_KEYWORDS_EN全体を検索

## 実行手順

### Step 1: 検索実行

```bash
# 単一キーワード検索
/Users/ksato/workspace/.venv/bin/python \
  /Users/ksato/workspace/shared/_codex/common/ops/scripts/x_research/buzz_discovery.py \
  --query "[キーワード] lang:en" \
  --min-engagement 50

# 複数キーワード検索（config.pyから）
for keyword in SEARCH_KEYWORDS_EN:
    buzz_discovery.py --query "$keyword" --min-engagement 50
```

### Step 2: 候補選定基準

| 項目 | 基準 | 優先度 |
|------|------|--------|
| 鮮度 | 24時間以内 | 高 |
| 鮮度 | 48時間以内 | 中 |
| Engagement | 500+ | 高 |
| Engagement | 100+ | 中 |
| Engagement | 50+ | 低 |
| 内容 | 日本で未紹介 | 高 |
| 発信者 | 開発者本人 | 高 |
| 種類 | 新機能/アップデート | 高 |
| 種類 | ユースケース/ノウハウ | 中 |

### Step 3: 結果整理

`_inbox/sns_candidates.md` に保存される形式:
```markdown
## 1. [Username] (@handle)

**投稿日**: [日時]
**Score**: [score] (engagement: [eng], relevance: [rel])
**Likes**: [X] | **RTs**: [X] | **Replies**: [X] | **Views**: [X]

> [投稿内容の一部]

**URL**: [tweet_url]
```

## 出力

```markdown
# Phase 1: Buzz Discovery 結果

## 検索条件
- キーワード: [検索キーワード]
- 最小エンゲージメント: 50
- 実行日時: [日時]

## 候補一覧

### 推奨候補（上位3件）

1. **@[handle]** - [投稿内容要約]
   - Score: [X]
   - 鮮度: [X時間前]
   - URL: [url]
   - 推奨理由: [理由]

2. ...

### 全候補
[_inbox/sns_candidates.md 参照]

## 次Phaseへの引き継ぎ
- 選定候補: [推奨候補から1件選択]
- 元ツイートURL: [url]
```

## Success Criteria

- [ ] 検索が実行されている
- [ ] 候補が5件以上リストアップされている
- [ ] 各候補にスコア・URL・内容が含まれている
- [ ] 推奨候補が3件以上ある

## エラーハンドリング

### API制限エラー (429)
```
{"error":"Too Many Requests","message":"..."}
```
→ 5秒待機して再実行、またはクレジット確認

### クレジット不足 (402)
```
Credits is not enough. Please recharge
```
→ ブックマークから抽出に切り替え:
```bash
/Users/ksato/workspace/.venv/bin/python \
  /Users/ksato/workspace/shared/_codex/common/ops/scripts/x_oauth2.py \
  --bookmarks
```

### 候補0件
→ 検索キーワードを変更して再実行
→ min-engagementを20に下げて再実行
