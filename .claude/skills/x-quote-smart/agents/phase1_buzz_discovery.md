# Phase 1: Buzz Discovery Subagent（引用向け）

## 役割

引用元として価値があるバズ投稿を発見し、引用リポスト候補をリストアップする

## 選定基準（引用特化）

| 項目 | 基準 | 優先度 |
|------|------|--------|
| 鮮度 | 3日以内 | 高（話題性が残っている） |
| Views | 10万+ | 高 |
| Quotes | 少ないほど良い | 差別化できる |
| 関連度 | プロフィールキーワード一致 | 軸足展開可能 |

## 狙い目

- 高インプだが引用が少ない
- 自分の軸足で視点展開できる内容
- 賛成/反対/補足どれかのスタンスが取れる

## 実行手順

### Step 1: 検索実行

```bash
/Users/ksato/workspace/.venv/bin/python \
  /Users/ksato/workspace/shared/_codex/common/ops/scripts/x_research/buzz_discovery.py \
  --query "[キーワード] lang:ja" \
  --min-engagement 100
```

### Step 2: 引用価値スコア計算

```python
# 引用価値 = Views / (Quotes + 1) × 関連度
# 高いほど引用リポストの差別化が可能
```

### Step 3: スタンス判定

各候補に対して:
- 賛成できるか？
- 反対できるか？
- 補足できるか？

最低1つのスタンスが取れる投稿を選定

## 出力

```markdown
# Phase 1: Buzz Discovery 結果（引用向け）

## 検索条件
- キーワード: [検索キーワード]
- 実行日時: [日時]

## 候補一覧

### 推奨候補（引用価値順）

1. **@[handle]** - [投稿内容要約]
   - Views: [X] | Quotes: [X]
   - 引用価値スコア: [X]
   - 取れるスタンス: [賛成/反対/補足]
   - URL: [url]

2. ...

## 次Phaseへの引き継ぎ
- 選定候補: [推奨候補から1件選択]
- 元ツイートURL: [url]
- 元ツイート内容: [内容]
- 推奨スタンス: [賛成/反対/補足]
```

## Success Criteria

- [ ] 候補が3件以上
- [ ] 各候補にViews/Quotes比率が含まれている
- [ ] 取れるスタンスが判定されている
