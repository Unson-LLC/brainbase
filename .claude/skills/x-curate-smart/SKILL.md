---
name: x-curate-smart
description: 海外バズ投稿を発見し、日本ユーザー向けにキュレーションするSubagent活用型4 Phase Orchestrator。Phase 1（バズ発見）→ Phase 2（キュレーション分析+ドラフト作成）→ Phase 2.5（文体レビュー）→ Phase 3（実行）のworkflowで、情報鮮度による先行者優位を自動化
---

## Triggers

以下の状況で使用:
- **/curate と呼ばれたとき**
- **海外の最新情報を日本向けに発信したいとき**
- **情報鮮度で先行者優位を取りたいとき**
- **引用リポスト候補を探したいとき**

# x-curate-smart Orchestrator

**バージョン**: v1.0
**実装日**: 2026-01-04
**目的**: 海外バズ × ユーザー需要 × 軸足 = 高価値キュレーション

---

## Orchestration Overview

このOrchestratorは、**海外バズ投稿の発見からキュレーション投稿まで**を自動化:

```
Phase 1: Buzz Discovery（バズ発見）
└── agents/phase1_buzz_discovery.md
    └── buzz_discovery.py でキーワード検索
    └── config.py のSEARCH_KEYWORDS_EN使用
    └── engagement + relevance でスコアリング
    └── 上位候補を _inbox/sns_candidates.md に保存

Phase 2: Curation Analysis（キュレーション分析+ドラフト作成）
└── agents/phase2_curation_analysis.md
    └── x-curate-strategy Skillを装備
    └── 選定された投稿の翻訳
    └── 軸足ベースの価値上乗せ
    └── フック→問題提起→共感→解決策→CTAの構成
    └── 2-3案のドラフト作成

Phase 2.5: Style Review（文体レビュー）
└── agents/phase2_5_style_review.md
    └── style_guide.md のチェックリスト適用
    └── AIっぽさ排除（句点、鉤括弧、箇条書き、太字）
    └── スコアリング（80点以上で合格）
    └── 修正後ドラフト出力

Phase 3: Execution（実行）
└── x_client.py で投稿実行
    └── リプライで元ツイートURL追加（オプション）
    └── 投稿ID取得
```

**効果**:
| 指標 | 手動実施 | Orchestrator使用 | 改善率 |
|------|---------|-----------------|--------|
| バズ発見時間 | 30分〜1時間 | 5分 | -91.7% |
| 翻訳+軸足追加 | 30分 | 10分 | -66.7% |
| 文体レビュー | 15分 | 5分 | -66.7% |
| **合計** | **1.5〜2時間** | **20分** | -83.3% |

---

## 使い方

### 基本的な使い方

**ユーザー**: /curate [キーワード or 空欄]

**期待される動作**:
1. **Phase 1 Subagentが起動**
   - キーワード指定時: そのキーワードで検索
   - 空欄時: config.py のSEARCH_KEYWORDS_EN全体を検索
   - _inbox/sns_candidates.md に候補保存

2. **Phase 2 Subagentが起動**
   - 選定された投稿（または上位候補）を分析
   - x-curate-strategy Skillで翻訳+軸足追加
   - 2-3案のドラフト作成

3. **Phase 2.5 Subagentが起動**
   - style_guide.mdでチェック
   - AIっぽさ排除
   - スコア80点以上で合格

4. **Phase 3で投稿実行**
   - x_client.py で投稿
   - 元ツイートURLをリプライ追加（オプション）

---

## Phase詳細

### Phase 1: Buzz Discovery（バズ発見）

**Subagent**: `agents/phase1_buzz_discovery.md`

**目的**: 海外のバズ投稿を発見し、キュレーション候補をリストアップ

**使用スクリプト**:
```bash
/Users/ksato/workspace/.venv/bin/python \
  /Users/ksato/workspace/shared/_codex/common/ops/scripts/x_research/buzz_discovery.py \
  --query "[キーワード] lang:en" \
  --min-engagement 50
```

**検索キーワード**（config.py より）:
```python
SEARCH_KEYWORDS_EN = [
    "Claude Code lang:en",
    "MCP server lang:en",
    "Anthropic Claude lang:en",
    "Cursor AI lang:en",
    "AI coding lang:en",
    "solopreneur AI lang:en",
    "AI automation business lang:en",
]
```

**選定基準**（優先度順）:
| 項目 | 基準 | 優先度 |
|------|------|--------|
| **フォロワー適合** | 反応パターンに合致 | ★★★ 最重要 |
| 鮮度 | 48時間以内（理想は24時間） | ★★☆ |
| Engagement | 50+（Viewsより実際の反応重視） | ★★☆ |
| 内容 | 日本で未紹介 or 深掘り価値あり | ★☆☆ |

**フォロワーが反応するパターン**（実データ分析）:
- ⚠️ **AIの限界・落とし穴**（「これはできない」「危険」）
- 💥 **期待vs現実**（「〇〇できると思ってた→詰んだ」）
- 🔄 **ツール比較**（実践者目線で「こっち選んだ理由」）
- 🛠️ **失敗→解決**

**避けるべきパターン**:
- 純粋な技術Tips（詳細すぎる）
- 新機能紹介のみ（実践なし）
- 数字・実績報告のみ

**出力**: `_inbox/sns_candidates.md`

**Success Criteria**:
- [ ] 検索が実行されている
- [ ] 候補が5件以上リストアップされている
- [ ] 各候補にスコア・URL・内容が含まれている

---

### Phase 2: Curation Analysis（キュレーション分析+ドラフト作成）

**Subagent**: `agents/phase2_curation_analysis.md`

**目的**: 選定された投稿を翻訳し、軸足ベースの価値を上乗せしたドラフトを作成

**使用Skills**:
- `x-curate-strategy`: 海外キュレーション戦略

**軸足チェック**（佐藤圭吾の場合）:
- 7事業を1人で並行運営
- brainbase（AI管理OS）開発者
- Claude Code Meetup登壇者
- 「AIにマネジメントを丸投げする男」

**ドラフト構成**:
```
【フック】常識破壊の1行 or 情報の希少性・鮮度を示す

【問題提起】なぜこれが重要か

【共感】自分の実体験（軸足ベース）

【解決策】具体的なアクション

【CTA】問いかけで締める
```

**1行目テンプレート**:
```
速報系: 「海外で話題の〇〇」「これ、日本ではまだ知られてないけど」
実践系: 「海外で話題の〇〇、試してみた」「英語圏でバズってる〇〇を実践」
解説系: 「〇〇（開発者）が公開した〇〇を解説」
意見系: 「〇〇は半分正解で半分間違い」「〇〇、ちょっと違うと思う」
```

**出力**:
```markdown
━━━━━━━━━━━━━━━━━━━━
📝 案1（[形式]）
━━━━━━━━━━━━━━━━━━━━

【フック】
（1行目）

【問題提起】
（なぜ重要か）

【共感】
（自分の実体験）

【解決策】
（具体的アクション）

【CTA】
（問いかけ）

元ツイート: [URL]
━━━━━━━━━━━━━━━━━━━━
```

**Success Criteria**:
- [ ] 2-3案のドラフトが生成されている
- [ ] フック→問題提起→共感→解決策→CTAの構成が整っている
- [ ] 軸足ベースの実体験が含まれている
- [ ] 元ツイートURLが含まれている

---

### Phase 2.5: Style Review（文体レビュー）

**Subagent**: `agents/phase2_5_style_review.md`

**目的**: ドラフトの文体・トンマナをレビューし、AIっぽさを排除

**使用ファイル**: `/Users/ksato/workspace/shared/_codex/sns/style_guide.md`

**チェックリスト**:
- [ ] 末尾の「。」を削除
- [ ] 不要な鉤括弧「」を削除（例外: 直接引用、初出専門用語）
- [ ] 箇条書き「-」をカンマ区切りまたは改行区切りに変換
- [ ] Markdown強調「**」を削除または最小限に
- [ ] 丁寧語・硬い表現を口語に変換

**スコアリング基準**:
- 末尾「。」: -10点/箇所
- 不要な鉤括弧: -5点/箇所
- 箇条書き: -10点/使用
- 不要な太字: -10点/箇所
- 丁寧語: -5点/箇所

**合格ライン**: 80点以上

**出力**:
```markdown
# Phase 2.5 レビュー結果

## スコア: XX点 / 100点

## 検出されたNG項目
[詳細リスト]

## 修正後ドラフト
[修正済みテキスト]

## 文体レビュー判定
✅ 合格（80点以上） / ❌ 不合格（80点未満）
```

**Success Criteria**:
- [ ] スコア80点以上
- [ ] AIっぽさが排除されている
- [ ] 口語表現が使われている

---

### Phase 3: Execution（実行）

**目的**: 最終ドラフトをXに投稿

**使用スクリプト**:
```bash
# 投稿
/Users/ksato/workspace/.venv/bin/python \
  /Users/ksato/workspace/shared/_codex/common/ops/scripts/x_client.py \
  "[投稿テキスト]"

# リプライで元ツイートURL追加（オプション）
# 現在x_client.pyにreply機能なし、手動追加
```

**出力**: 投稿URL

**Success Criteria**:
- [ ] 投稿が成功している
- [ ] 投稿URLが取得されている

---

## Orchestrator Responsibilities

### Phase Management

**各Phaseの完了を確認**:
- Phase 1の成果物: `_inbox/sns_candidates.md`
- Phase 2の成果物: ドラフト2-3案
- Phase 2.5の成果物: 修正後ドラフト、スコア
- Phase 3の成果物: 投稿URL

**Phase間のデータ受け渡しを管理**:
- Phase 1の候補リスト → Phase 2で選定・分析
- Phase 2のドラフト → Phase 2.5でレビュー
- Phase 2.5の修正後ドラフト → Phase 3で投稿

---

### Review & Replan

**Review実施** (各Phase完了後):

1. **ファイル存在確認**
   - Phase 1: `_inbox/sns_candidates.md` が更新されているか
   - Phase 2: ドラフトが2案以上あるか
   - Phase 2.5: スコアが80点以上か

2. **Success Criteriaチェック**
   - 各PhaseのSuccess Criteriaを確認

3. **リスク判定**
   - **Critical**: リプラン実行
     - Phase 1: 候補が0件
     - Phase 2: ドラフトが1案未満
     - Phase 2.5: スコア80点未満
   - **Minor**: 警告+進行許可
   - **None**: 承認

**Replan実行** (Critical判定時):
- Max Retries: 3回
- 3回超過時は人間へエスカレーション

---

## Expected Output

### 成功時

```markdown
# x-curate-smart 実行結果

**作成日**: 2026-01-04
**キーワード**: [検索キーワード]
**Phase数**: 4

## Phase 1: Buzz Discovery
候補数: 5件
最高スコア候補: @[username] ([score])
URL: [tweet_url]

## Phase 2: Curation Analysis
元ツイート: [元ツイート要約]
選択案: 案1（意見系）

## Phase 2.5: Style Review
スコア: 95点 / 100点
判定: ✅ 合格

## Phase 3: Execution
投稿URL: https://x.com/...

---

**Success Criteria達成率**: 100%
```

---

## スクリプトパス正本

| スクリプト | パス |
|-----------|------|
| Buzz Discovery | `/Users/ksato/workspace/shared/_codex/common/ops/scripts/x_research/buzz_discovery.py` |
| X Client | `/Users/ksato/workspace/shared/_codex/common/ops/scripts/x_client.py` |
| Config | `/Users/ksato/workspace/shared/_codex/common/ops/scripts/x_research/config.py` |
| Style Guide | `/Users/ksato/workspace/shared/_codex/sns/style_guide.md` |

---

## 関連Skills

- `x-curate-strategy`: 海外キュレーション戦略（翻訳+軸足）
- `x-quote-strategy`: 引用リポスト戦略
- `x-reply-strategy`: リプライ戦略
- `sns-smart`: SNS投稿全自動化（自己発信型）

---

## バージョン履歴

### v1.0 (2026-01-04)
- 初版作成
- 4 Phase workflow実装
- buzz_discovery.py連携
- style_guide.mdチェック統合

---

**最終更新**: 2026-01-04
**作成者**: Claude Code
**ステータス**: Active
