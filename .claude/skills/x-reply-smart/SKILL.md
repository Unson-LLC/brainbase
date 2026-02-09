---
name: x-reply-smart
description: バズ投稿のコメント欄上位を狙うSubagent活用型4 Phase Orchestrator。Phase 1（バズ発見）→ Phase 2（リプライドラフト作成）→ Phase 2.5（文体レビュー）→ Phase 3（実行）のworkflowで、元投稿を補強するエビデンスベースのリプライを自動化
---

## Triggers

以下の状況で使用:
- **/reply と呼ばれたとき**
- **リプ欄の上位表示を狙いたいとき**
- **バズ投稿に便乗して認知を取りたいとき**

# x-reply-smart Orchestrator

**バージョン**: v1.0
**実装日**: 2026-01-04
**目的**: コメント欄上位に表示され、元投稿の読者に刺さる

---

## 戦略の本質

**Xアルゴリズムの特性**:
> リプ欄にエビデンスベースで論理が整った指摘をすると、リプ欄の一番上に表示されやすくなる

**3原則**:
1. 元投稿を否定せず「補強」する
2. エビデンスベース・論理的な指摘
3. 自分のプロフィールへの誘導

---

## Orchestration Overview

```
Phase 1: Buzz Discovery（バズ発見 - リプ向け）
└── agents/phase1_buzz_discovery.md
    └── buzz_discovery.py で検索
    └── Views/Replies比率でスコアリング
    └── コメント欄が薄い投稿を優先
    └── _inbox/sns_candidates.md に保存

Phase 2: Reply Draft（リプライドラフト作成）
└── agents/phase2_reply_draft.md
    └── x-reply-strategy Skillを装備
    └── 元投稿を補強する形式
    └── エビデンス・数字を含める
    └── 2-3案のドラフト作成

Phase 2.5: Style Review（文体レビュー）
└── agents/phase2_5_style_review.md
    └── style_guide.md のチェックリスト適用
    └── AIっぽさ排除
    └── スコア80点以上で合格

Phase 3: Execution（実行）
└── x_client.py --reply で投稿
    └── 投稿ID取得
```

---

## 使い方

**ユーザー**: /reply [ツイートURL or キーワード]

**期待される動作**:
1. URL指定時: そのツイートにリプライ
2. キーワード指定時: Phase 1でバズ投稿を検索
3. 空欄時: _inbox/sns_candidates.md から選定

---

## Phase詳細

### Phase 1: Buzz Discovery（リプ向け）

**Subagent**: `agents/phase1_buzz_discovery.md`

**選定基準**（リプライ特化）:
| 項目 | 基準 | 理由 |
|------|------|------|
| 鮮度 | 24時間以内 | リプ欄の競争が少ない |
| Views | 5万+ | 認知効果 |
| Replies | 10以下 | コメント欄が薄い = 上位狙える |
| Views/Replies | 高いほど良い | 薄さの指標 |

**狙い目**:
- 100万インプ以上なのにコメント欄が薄い
- 一言感想（「すごい」「参考になる」）ばかり
- 論理的な補足が入っていない

**Success Criteria**:
- [ ] 候補が3件以上
- [ ] 各候補にViews/Replies比率が含まれている

---

### Phase 2: Reply Draft（リプライドラフト作成）

**Subagent**: `agents/phase2_reply_draft.md`

**1行目テンプレート**（元投稿との接続）:
```
補強: 「これですね」「まさに」「補足すると」
具体化: 「自分の場合は」「実際にやってみると」
実例: 「〇〇でも同じで」
```

**構成**:
```
【接続】元投稿との接続（1行目）

【実体験】自分の具体例

【エビデンス】数字・結論
```

**ポイント**:
- 元投稿を否定しない
- 具体的な数字・事例を入れる
- 自分の専門性が伝わる内容

**Success Criteria**:
- [ ] 2-3案のドラフト
- [ ] 元投稿を補強する形式
- [ ] エビデンス・数字が含まれている

---

### Phase 2.5: Style Review

**Subagent**: `agents/phase2_5_style_review.md`

（x-curate-smartと共通）

**Success Criteria**:
- [ ] スコア80点以上
- [ ] AIっぽさ排除

---

### Phase 3: Execution

**実行コマンド**:
```bash
# リプライ投稿（x_client.pyにreply機能追加後）
/Users/ksato/workspace/.venv/bin/python \
  /Users/ksato/workspace/shared/_codex/common/ops/scripts/x_client.py \
  --reply <tweet_id> "[投稿テキスト]"
```

**現状**: x_client.pyにreply機能未実装 → 手動投稿

---

## 例

**元投稿**: @MLBear2「Boris氏の活用法、並列作業させるのがコツ」

**リプライドラフト**:
```
並列作業させる、ってこれですね

自分は7事業を1人で回してますが
事業ごとにworktreeを切って
Claude Codeを並列起動してます

Borisさんの「カスタマイズせず」は本当で
CLAUDE.mdだけ整えれば十分動く
```

---

## 引用リポストとの使い分け

| 項目 | リプライ | 引用リポスト |
|------|---------|-------------|
| 表示場所 | 元投稿のコメント欄 | 自分のTL |
| 目的 | コメント欄上位で認知獲得 | 自分の視点を展開 |
| トーン | 元投稿を補強 | 自分の主張を展開 |
| 適したケース | 元投稿が強い | 自分の切り口がある |

---

## 関連Skills

- `x-quote-smart`: 引用リポスト戦略（Subagent版）
- `x-curate-smart`: 海外キュレーション戦略
- `sns-smart`: SNS投稿全般のOrchestrator

---

**最終更新**: 2026-01-04
**ステータス**: Active
