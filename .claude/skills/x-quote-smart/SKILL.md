---
name: x-quote-smart
description: バズ投稿を引用して自分のTLに載せるSubagent活用型4 Phase Orchestrator。Phase 1（バズ発見）→ Phase 2（引用ドラフト作成）→ Phase 2.5（文体レビュー）→ Phase 3（実行）のworkflowで、軸足ベースの視点展開を自動化
---

## Triggers

以下の状況で使用:
- **/quote と呼ばれたとき**
- **引用リポストで露出を取りたいとき**
- **バズ投稿に乗っかりたいとき**

# x-quote-smart Orchestrator

**バージョン**: v1.1
**実装日**: 2026-01-04
**最終更新**: 2026-01-04
**目的**: 他人のインプレッションを借りて、自分の視点を展開する

**v1.1変更点**: Phase 1.5（元投稿分析）を追加。元投稿の全文を精査せずにドラフトを作成し、既出論点と重複する失敗を防止

---

## 戦略の本質

**3原則**:
1. 元投稿の高インプレッションに乗る
2. 自分のTLに流れる（フォロワーに届く）
3. 軸足（専門性）を示す機会

---

## Orchestration Overview

```
Phase 1: Buzz Discovery（バズ発見 - 引用向け）
└── agents/phase1_buzz_discovery.md
    └── buzz_discovery.py で検索
    └── Views/Quotes比率でスコアリング
    └── 引用元として価値がある投稿を優先
    └── _inbox/sns_candidates.md に保存

Phase 1.5: Source Analysis（元投稿分析）★NEW
└── agents/phase1_5_source_analysis.md
    └── 元投稿の全文を取得（長文でも省略しない）
    └── 主張・根拠・結論を構造化
    └── 既出の論点を洗い出し
    └── 「補足」できる余白を特定
    └── 重複リスクのある論点をフラグ

Phase 2: Quote Draft（引用ドラフト作成）
└── agents/phase2_quote_draft.md
    └── **前提: Phase 1.5の分析結果を入力として受け取る**
    └── x-quote-strategy Skillを装備
    └── スタンス明確化（賛成/反対/補足）
    └── 軸足ベースの視点展開
    └── 2-3案のドラフト作成
    └── **既出論点との重複チェック**

Phase 2.5: Style Review（文体レビュー）
└── agents/phase2_5_style_review.md
    └── style_guide.md のチェックリスト適用
    └── AIっぽさ排除
    └── スコア80点以上で合格

Phase 3: Execution（実行）
└── x_client.py で投稿
    └── 投稿後に元ツイートURLをスレッド追加
```

---

## 使い方

**ユーザー**: /quote [ツイートURL or キーワード]

**期待される動作**:
1. URL指定時: そのツイートを引用
2. キーワード指定時: Phase 1でバズ投稿を検索
3. 空欄時: _inbox/sns_candidates.md から選定

---

## Phase詳細

### Phase 1: Buzz Discovery（引用向け）

**Subagent**: `agents/phase1_buzz_discovery.md`

**選定基準**（引用特化）:
| 項目 | 基準 | 理由 |
|------|------|------|
| 鮮度 | 3日以内 | 話題性が残っている |
| Views | 10万+ | 認知効果 |
| Quotes | 少ないほど良い | 引用されていない = 差別化 |
| 関連度 | プロフィールキーワード一致 | 軸足展開可能 |

**Success Criteria**:
- [ ] 候補が3件以上
- [ ] 各候補にViews/Quotes比率が含まれている

---

### Phase 1.5: Source Analysis（元投稿分析）★NEW

**Subagent**: `agents/phase1_5_source_analysis.md`

**目的**: 元投稿を深く理解し、既出論点との重複を防ぐ

**実行タイミング**:
- URL指定時: Phase 1をスキップし、Phase 1.5から開始
- キーワード検索時: Phase 1の後にPhase 1.5を実行

**分析項目**:
| 項目 | 内容 | 出力形式 |
|------|------|----------|
| 全文取得 | 長文でも省略しない | テキスト |
| 主張 | 投稿者が言いたいこと | 1-2文 |
| 根拠 | 主張を支える理由・データ | 箇条書き |
| 結論 | 最終的な主張 | 1文 |
| 既出論点 | 投稿内で触れられている話題 | 箇条書き |
| 補足余白 | 触れられていない関連話題 | 箇条書き |
| 重複リスク | 自分が言いたいことが既出か | フラグ |

**出力形式**:
```markdown
## 元投稿分析結果

### 基本情報
- 投稿者: @xxx
- 投稿日時: YYYY-MM-DD HH:MM
- エンゲージメント: Views XX万 / Quotes XX

### 構造化
- **主張**: [1-2文]
- **根拠**:
  - [根拠1]
  - [根拠2]
- **結論**: [1文]

### 既出論点（これらは「補足」で触れてはいけない）
1. [既出論点1] - 該当箇所: "引用"
2. [既出論点2] - 該当箇所: "引用"
3. [既出論点3] - 該当箇所: "引用"

### 補足可能な余白（触れられていない話題）
1. [余白1]
2. [余白2]

### 重複リスク判定
- 「検証」→ ⚠️ 既出（予想3で言及済み）
- 「RACI」→ ✅ 未出（補足可能）
```

**Success Criteria**:
- [ ] 元投稿の全文を取得（省略なし）
- [ ] 既出論点が3つ以上リストアップされている
- [ ] 補足可能な余白が特定されている
- [ ] 重複リスクが判定されている

---

### Phase 2: Quote Draft（引用ドラフト作成）

**Subagent**: `agents/phase2_quote_draft.md`

**1行目テンプレート**（スタンス明確化）:
```
賛成: 「これ、超わかる」「まさにこれ」「めちゃくちゃわかる」
反対: 「これ、ちょっと違うと思う」「逆だと思う」「半分正解で半分間違い」
補足: 「これに付け加えると」「自分の経験では」
```

**軸足チェック**（佐藤圭吾の場合）:
- AIにマネジメントを丸投げする男
- 7事業を1人で並行運営
- brainbase（AI管理OS）開発者
- Claude Code Meetup登壇者

**構成**:
```
【スタンス】1行目でスタンス明確化

【実体験】自分の具体例（軸足ベース）

【結論】主張・問いかけ
```

**Success Criteria**:
- [ ] 2-3案のドラフト
- [ ] スタンスが明確（賛成/反対/補足）
- [ ] 軸足ベースの実体験が含まれている

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
# 引用投稿
/Users/ksato/workspace/.venv/bin/python \
  /Users/ksato/workspace/shared/_codex/common/ops/scripts/x_client.py \
  "[投稿テキスト]"

# リプライで元ツイートURL追加
# （手動 or 将来的にスレッド機能追加）
```

---

## 例

**元投稿**: @kzkHykw1991「Claude Codeと夜鍋したら一晩でiOSアプリできた」

**引用ドラフト**:
```
これ、超わかる

自分もbrainbase（AI管理OS）を
Claude Codeで作ってるけど
「一晩で動く」と「運用に耐える」は別物

一晩で作る → 2週間で壊れない設計に直す
このサイクルが正解
```

---

## リプライとの使い分け

| 項目 | 引用リポスト | リプライ |
|------|-------------|---------|
| 表示場所 | 自分のTL | 元投稿のコメント欄 |
| 目的 | 自分の視点を展開 | コメント欄上位で認知獲得 |
| トーン | 自分の主張を展開 | 元投稿を補強 |
| 適したケース | 自分の切り口がある | 元投稿が強い |

---

## 関連Skills

- `x-reply-smart`: リプライ戦略（Subagent版）
- `x-curate-smart`: 海外キュレーション戦略
- `sns-smart`: SNS投稿全般のOrchestrator

---

**最終更新**: 2026-01-04
**ステータス**: Active
