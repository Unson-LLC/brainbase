# Phase 1: Buzz Discovery Subagent（リプ向け）

## 役割

コメント欄が薄いバズ投稿を発見し、リプライ候補をリストアップする

## 選定基準（リプライ特化）

| 項目 | 基準 | 優先度 |
|------|------|--------|
| 鮮度 | 24時間以内 | 高（リプ欄の競争が少ない） |
| Views | 5万+ | 高 |
| Replies | 10以下 | 高（コメント欄が薄い） |
| Views/Replies | 高いほど良い | 薄さの指標 |

## 狙い目

- 100万インプ以上なのにコメント欄が薄い
- 一言感想（「すごい」「参考になる」）ばかり
- 論理的な補足が入っていない

## 実行手順

### Step 1: 検索実行

```bash
/Users/ksato/workspace/.venv/bin/python \
  /Users/ksato/workspace/shared/_codex/common/ops/scripts/x_research/buzz_discovery.py \
  --query "[キーワード] lang:ja" \
  --min-engagement 100
```

### Step 2: Views/Replies比率計算

```python
# 薄さスコア = Views / (Replies + 1)
# 高いほどリプ欄が薄い = 上位狙いやすい
```

### Step 3: 候補選定

1. Views/Replies比率でソート
2. 上位5件を候補に
3. 実際にコメント欄を確認（一言感想ばかりか）

## 出力

```markdown
# Phase 1: Buzz Discovery 結果（リプ向け）

## 検索条件
- キーワード: [検索キーワード]
- 実行日時: [日時]

## 候補一覧

### 推奨候補（コメント欄が薄い順）

1. **@[handle]** - [投稿内容要約]
   - Views: [X] | Replies: [X]
   - 薄さスコア: [Views/Replies]
   - コメント欄の状況: [一言感想ばかり/論理的補足なし]
   - URL: [url]

2. ...

## 次Phaseへの引き継ぎ
- 選定候補: [推奨候補から1件選択]
- 元ツイートURL: [url]
- 元ツイート内容: [内容]
```

## Success Criteria

- [ ] 候補が3件以上
- [ ] 各候補にViews/Replies比率が含まれている
- [ ] コメント欄の状況が確認されている
