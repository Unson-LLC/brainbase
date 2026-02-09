---
name: x-quote-strategy
description: X引用リポスト戦略。バズ投稿を引用して自分のTLに載せ、軸足ベースで視点を展開する。候補選定→ドラフト→レビュー→実行の4ステップ。
---

# X 引用リポスト戦略

## Triggers

- 引用リポストで露出を取りたいとき
- バズ投稿に乗っかりたいとき
- `/quote` と呼ばれたとき

---

## 戦略の本質

**他人のインプレッションを借りて、自分の視点を展開する**

- 元投稿の高インプレッションに乗る
- 自分のTLに流れる（フォロワーに届く）
- 軸足（専門性）を示す機会

---

## 4ステップ

### Step 1: 候補選定

**条件**:
| 項目 | 基準 |
|------|------|
| 鮮度 | 3日以内 |
| Views | 10万+ |
| Replies | 10以下（コメント欄薄い） |
| 関連度 | プロフィールキーワードと一致 |

**実行**:
```bash
python /Users/ksato/workspace/shared/_codex/common/ops/scripts/x_research/buzz_discovery.py \
  --query "Claude Code OR ChatGPT OR AI lang:ja" \
  --min-engagement 100
```

**選定基準**: `Views / Replies` 比率が高いほど良い

---

### Step 2: ドラフト作成

**1行目テンプレート**（スタンス明確化）:
```
賛成: 「これ、超わかる」「まさにこれ」
反対: 「これ、ちょっと違うと思う」「逆だと思う」
補足: 「これに付け加えると」「自分の経験では」
```

**軸足チェック**（佐藤圭吾の場合）:
- AIにマネジメントを丸投げする男
- 7事業を1人で並行運営
- brainbase（AI管理OS）開発者
- Claude Code Meetup登壇者

**構成**:
```
[1行目: スタンス明確化]
[空行]
[実体験・エビデンス]
[空行]
[結論・主張]
```

---

### Step 3: 簡易レビュー（3項目）

| チェック | 基準 |
|---------|------|
| 1行目スタンス | 賛成/反対/補足が明確か |
| AIっぽさ排除 | 句点(。)を減らす、口語調に |
| 軸足一貫性 | プロフィールと矛盾しないか |

**NG例**:
- 「〜と思います。」→ 「〜と思う」
- 「〜ではないでしょうか。」→ 「〜じゃないかな」
- 軸足と無関係な主張

---

### Step 4: 実行

**dry-run**:
```python
from x_client import post_tweet
post_tweet(text, quote_tweet_id='<tweet_id>', dry_run=True)
```

**本番**:
```python
post_tweet(text, quote_tweet_id='<tweet_id>')
```

---

## 例

**元投稿**: @kzkHykw1991「Claude Codeと夜鍋したら一晩でiOSアプリできた」

**引用リポスト**:
```
これ、超わかる

自分もbrainbase（AI管理OS）を
Claude Codeで作ってるけど
「一晩で動く」と「運用に耐える」は別物

一晩で作る → 2週間で壊れない設計に直す
このサイクルが正解
```

---

## 関連

- `x-reply-strategy`: リプライ戦略
- `sns-smart`: SNS投稿全般のOrchestrator
- `buzz_discovery.py`: 候補発見スクリプト
