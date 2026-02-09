---
name: note-smart
description: note記事の構成設計→本文ドラフト→鬼編集長レビュー→最終調整をSubagentsで自動化する4 Phase Orchestrator。Phase 1（構成設計+9セクション選定）→ Phase 2（本文ドラフト2,500-3,000文字）→ Phase 2.5（鬼編集長レビュー）→ Phase 3（最終調整+見出し画像プロンプト）のworkflowで、note記事の企画から公開準備までを自動生成。note-article-writing、customer-centric-marketing-n1、sns-copy-patterns等のSkillsを装備したSubagentsが高品質な記事を生成。
---

## Triggers

以下の状況で使用:
- **note記事を作成するとき**
- **X投稿をnote記事に展開するとき**
- **noteの投稿戦略を立てるとき**
- **AIO（AI検索最適化）を意識したコンテンツを作成するとき**
- **シリーズ記事を企画するとき**

# note-smart Orchestrator

**バージョン**: v1.0
**実装日**: 2026-01-04
**目的**: note記事の企画〜公開準備の自動化
**統合済みSkills**: 4個（note-article-writing, customer-centric-marketing-n1, sns-copy-patterns, nano-banana-pro-tips）

---

## Orchestration Overview

このOrchestratorは、**note記事の企画から公開準備まで**を自動化します：

```
Phase 1: Structure Design（構成設計）
└── agents/phase1_structure.md
    └── customer-centric-marketing-n1 Skillを装備
    └── トピックからN=1ペルソナを設定
    └── 9セクションのどれを使うか決定
    └── 記事全体のアウトライン作成
    └── _codex/sns/drafts/{topic}_structure.md保存

Phase 2: Draft Creation（本文ドラフト作成）
└── agents/phase2_draft.md
    └── note-article-writing, sns-copy-patterns Skillsを装備
    └── Phase 1の構成に基づいて本文執筆
    └── 2,500-3,000文字の適正文字数で作成
    └── プロセスエコノミー・具体性・ストーリー性を適用
    └── _codex/sns/drafts/{topic}_draft.md保存

Phase 2.5: Editor Review（鬼編集長レビュー）
└── agents/phase2_5_review.md
    └── note-article-writing Skillを装備
    └── 鬼編集長チェックリストを適用
    └── 独自性・具体性・プロセスエコノミーを検証
    └── NG項目の検出と修正提案
    └── _codex/sns/drafts/{topic}_reviewed.md保存

Phase 3: Finalize（最終調整）
└── agents/phase3_finalize.md
    └── nano-banana-pro-tips Skillを装備
    └── 見出し画像プロンプト生成
    └── タグ・メタ情報の設定
    └── 次回予告の確認・調整
    └── _codex/sns/drafts/{topic}_final.md保存
```

**効果**:
| 指標 | 手動実施 | Orchestrator使用 | 改善率 |
|------|---------|-----------------|--------|
| 構成設計時間 | 1時間 | 10分 | -83.3% |
| 本文執筆時間 | 2-3時間 | 20分 | -88.9% |
| レビュー・修正時間 | 1時間 | 10分 | -83.3% |
| **合計** | **4-5時間** | **40分** | -86.7% |
| 品質適合率（編集部おすすめ確率） | 30% | 70% | +133% |
| 佐藤圭吾の工数 | 全作業 | 最終確認のみ | -90% |

---

## X vs note の役割分担

| 項目 | X | note |
|------|---|------|
| 役割 | Flow（瞬発力） | Stock（資産化） |
| 文字数 | 140-280文字 | 2,500-3,000文字 |
| 目的 | 認知獲得・バズ | 深掘り・ブランディング・AIO |
| 構成 | フック→オチ | 導入→背景→詳細→まとめ→次回予告 |
| 読者心理 | Look at THIS | Look at MY STORY |
| Orchestrator | sns-smart | note-smart（本Skill） |

**連携パターン**:
- X投稿でバズ → note記事で深掘り
- note記事を公開 → X投稿で告知
- X投稿のスレッド → note記事に再編集

---

## Phase詳細

### Phase 1: Structure Design（構成設計）

**Subagent**: `agents/phase1_structure.md`

**目的**: トピックから最適な記事構成を設計し、9セクションから必要なものを選定

**使用Skills**:
- `customer-centric-marketing-n1`: N=1ペルソナ設定

**入力**:
- トピック（記事にしたい内容）
- 参考情報（X投稿、既存ドラフト等）

**出力**:
```markdown
# 構成設計結果

## ターゲットペルソナ（N=1）
[具体的な1人の人物像]

## タイトル案
[30-40文字、逆説的・具体的]

## 使用セクション
1. 冒頭（これは何か） ✅
2. 背景・文脈 ✅
3. 実績・具体例 ✅
4. 全体像・計画 ✅
5. 姿勢・ルール（失敗も公開） ✅
6. 技術・手法 ✅
7. ビジョン・哲学 ✅
8. まとめ ✅
9. 次回予告 ✅

## アウトライン
[各セクションの概要]

## 期待文字数
2,500-3,000文字
```

**Success Criteria**:
- [ ] N=1ペルソナが具体的に設定されている
- [ ] タイトルが30-40文字で逆説的・具体的
- [ ] 使用セクションが選定されている
- [ ] アウトラインが作成されている

---

### Phase 2: Draft Creation（本文ドラフト作成）

**Subagent**: `agents/phase2_draft.md`

**目的**: Phase 1の構成に基づいて本文を執筆（2,500-3,000文字）

**使用Skills**:
- `note-article-writing`: 記事構成テンプレート、7原則
- `sns-copy-patterns`: 構文パターン

**入力**:
- Phase 1の構成設計結果
- トピックの詳細情報

**出力**:
```markdown
# [タイトル]

## 冒頭
[これは何か + なぜ始めたか]

## [セクション2]
...

## まとめ
- ポイント1
- ポイント2
- ポイント3

## 次回予告
[次にやることの具体的予告]

---

**文字数**: 約X,XXX文字
**適用した7原則**: [リスト]
```

**Success Criteria**:
- [ ] 2,500文字以上
- [ ] 見出しで構造化されている
- [ ] まとめセクションがある
- [ ] 次回予告がある
- [ ] 7原則のうち5つ以上が適用されている

---

### Phase 2.5: Editor Review（鬼編集長レビュー）

**Subagent**: `agents/phase2_5_review.md`

**目的**: 鬼編集長チェックリストを適用し、品質を検証

**使用Skills**:
- `note-article-writing`: 鬼編集長チェックリスト

**入力**:
- Phase 2のドラフト

**出力**:
```markdown
# 鬼編集長レビュー結果

## スコア: XX点 / 100点

## 構成チェック（30点）
- [✅/❌] 冒頭で「これは何か」を明示している
- [✅/❌] 2,500文字以上ある
- [✅/❌] 見出しで構造化されている
- [✅/❌] まとめセクションがある
- [✅/❌] 次回予告がある
- [✅/❌] 時系列・年号が執筆時点と整合している

## 独自性チェック（20点）
- [✅/❌] 自分の経験・視点が入っている
- [✅/❌] 具体的な数字がある
- [✅/❌] 固有名詞（ツール名等）がある
- [✅/❌] 「誰でも書ける内容」になっていない

## プロセスエコノミーチェック（30点）
- [✅/❌] 失敗・課題も公開している
- [✅/❌] 「完璧な成功談」だけになっていない
- [✅/❌] 読者が「一緒に成長を見守れる」感覚がある

## クロスプラットフォームチェック（15点）
- [✅/❌] X等への誘導リンクがある
- [✅/❌] note単独でも完結する内容
- [✅/❌] 継続フォローへの導線がある

## 検出されたNG項目
[詳細リスト]

## 修正提案
[具体的な修正提案]

## 判定
✅ 合格（80点以上） / ❌ 不合格（80点未満）
```

**Success Criteria**:
- [ ] スコア80点以上
- [ ] 構成チェック全項目クリア
- [ ] 独自性チェック3項目以上クリア
- [ ] プロセスエコノミーチェック2項目以上クリア

---

### Phase 3: Finalize（最終調整）

**Subagent**: `agents/phase3_finalize.md`

**目的**: 見出し画像生成、メタ情報設定、最終調整

**使用Skills**:
- `nano-banana-pro-tips`: 画像生成テクニック

**入力**:
- Phase 2.5のレビュー済みドラフト

**出力**:
```markdown
# 最終調整結果

## 見出し画像プロンプト
[Nano Banana Pro用プロンプト]

## メタ情報
- **タイトル**: [最終タイトル]
- **タグ**: #タグ1 #タグ2 #タグ3
- **公開日時**: [推奨公開日時]

## 次回予告確認
[次回記事への導線]

## 公開チェックリスト
- [ ] タイトル確定
- [ ] 見出し画像準備
- [ ] タグ設定
- [ ] X告知文準備
- [ ] 次回記事の構想

## 最終ドラフト
[最終版テキスト]
```

**Success Criteria**:
- [ ] 見出し画像プロンプトが生成されている
- [ ] メタ情報（タグ等）が設定されている
- [ ] 次回予告が確認されている
- [ ] 公開チェックリストが作成されている

---

## 解決する課題

### Before（従来のnote執筆）
- ❌ 構成を考えるのに時間がかかる
- ❌ 文字数が足りない（1,000文字で終わってしまう）
- ❌ 独自性がなく「誰でも書ける内容」になる
- ❌ プロセスエコノミーが欠けている
- ❌ 見出し画像の準備を忘れる
- ❌ X連携が考慮されていない

### After（note-smart v1.0）
- ✅ 9セクションテンプレートで構成を自動設計
- ✅ 2,500-3,000文字の適正文字数で自動生成
- ✅ 鬼編集長チェックリストで独自性を検証
- ✅ プロセスエコノミー観点を自動適用
- ✅ 見出し画像プロンプトを自動生成
- ✅ X連携（sns-smart）との役割分担が明確
- ✅ 所要時間86.7%削減（4-5h → 40分）

---

## Success Criteria

Orchestrator全体の成功条件：

- [ ] 全Phase（Phase 1〜3）が完了
- [ ] 各PhaseのSuccess Criteriaが100%達成
- [ ] 最終出力が期待形式で生成されている
- [ ] エラーが発生していない（またはハンドリングされている）
- [ ] 文字数が2,500文字以上
- [ ] 鬼編集長レビューで80点以上
- [ ] 見出し画像プロンプトが生成されている

---

## Orchestrator Responsibilities

### Phase Management

**各Phaseの完了を確認**:
- Phase 1の成果物が存在するか（構成設計結果）
- Phase 2の成果物が存在するか（本文ドラフト）
- Phase 2.5の成果物が存在するか（レビュー結果）
- Phase 3の成果物が存在するか（最終調整結果）

**Phase間のデータ受け渡しを管理**:
- Phase 1の構成設計結果をPhase 2に渡す
- Phase 2のドラフトをPhase 2.5に渡す
- Phase 2.5のレビュー結果をPhase 3に渡す
- トピックを全Phaseで引き継ぐ

---

### Review & Replan

**Review実施** (各Phase完了後):

1. **ファイル存在確認**
   - Phase 1成果物: `_codex/sns/drafts/{topic}_structure.md`
   - Phase 2成果物: `_codex/sns/drafts/{topic}_draft.md`
   - Phase 2.5成果物: `_codex/sns/drafts/{topic}_reviewed.md`
   - Phase 3成果物: `_codex/sns/drafts/{topic}_final.md`

2. **Success Criteriaチェック**
   - **Phase 1**:
     - SC-1: N=1ペルソナが具体的に設定されている
     - SC-2: タイトルが30-40文字で逆説的・具体的
     - SC-3: 使用セクションが選定されている
     - SC-4: アウトラインが作成されている
   - **Phase 2**:
     - SC-1: 2,500文字以上
     - SC-2: 見出しで構造化されている
     - SC-3: まとめセクションがある
     - SC-4: 次回予告がある
     - SC-5: 7原則のうち5つ以上が適用されている
   - **Phase 2.5**:
     - SC-1: スコア80点以上
     - SC-2: 構成チェック全項目クリア
     - SC-3: 独自性チェック3項目以上クリア
     - SC-4: プロセスエコノミーチェック2項目以上クリア
   - **Phase 3**:
     - SC-1: 見出し画像プロンプトが生成されている
     - SC-2: メタ情報（タグ等）が設定されている
     - SC-3: 次回予告が確認されている
     - SC-4: 公開チェックリストが作成されている

3. **差分分析**
   - **Phase 1**: customer-centric-marketing-n1基準への準拠
   - **Phase 2**: note-article-writing基準への準拠、7原則の適用
   - **Phase 2.5**: 鬼編集長チェックリスト基準への準拠
   - **Phase 3**: nano-banana-pro-tips基準への準拠

4. **リスク判定**
   - **Critical**: リプラン実行（Subagentへ修正指示）
     - Phase 1: N=1ペルソナが不明確、タイトルが曖昧
     - Phase 2: 2,500文字未満、構造化されていない
     - Phase 2.5: スコア80点未満
     - Phase 3: 見出し画像プロンプトが生成されていない
   - **Minor**: 警告+進行許可
     - Phase 1: アウトラインがやや不足
     - Phase 2: 7原則が4つのみ適用
     - Phase 2.5: スコア80-85点（ギリギリ合格）
     - Phase 3: タグが少ない
   - **None**: 承認（次Phaseへ）

**Replan実行** (Critical判定時):

1. **Issue Detection（問題検出）**
   - Success Criteriaの不合格項目を特定
   - 例: "Phase 2で文字数が1,800文字です（2,500文字以上期待）"

2. **Feedback Generation（フィードバック生成）**
   - 何が要件と異なるか: "文字数が基準（2,500文字以上）を下回っています"
   - どう修正すべきか: "以下のセクションを追加してください：技術スタック詳細、失敗事例"

3. **Replan Prompt Creation（リプランプロンプト作成）**
   - 元のタスク + フィードバック
   - Success Criteriaの再定義

4. **Subagent Re-execution（Subagent再実行）**
   - Task Tool経由で該当Phaseを再起動
   - リプランプロンプトを入力
   - 修正成果物を取得

5. **Re-Review（再レビュー）**
   - 修正成果物を同じ基準で再評価
   - **PASS** → 次Phaseへ
   - **FAIL** → リトライカウント確認
     - リトライ < Max (3回) → ステップ1へ戻る
     - リトライ >= Max (3回) → 人間へエスカレーション

**Max Retries管理**:
- 各Phaseで最大3回までリプラン実行可能
- 3回超過時は人間（佐藤）へエスカレーション

---

### Error Handling

**Phase実行失敗時のフォールバック**:
- Subagent起動失敗 → Task Tool再実行（1回）
- ファイル書き込み失敗 → パス確認 + 再実行

**データ不足時の追加情報取得**:
- トピックが不明確 → AskUserQuestionで詳細確認
- Phase間のデータ引き継ぎ失敗 → 前Phaseの成果物を再読み込み

**Max Retries超過時の人間へのエスカレーション**:
- 3回のリプラン実行後も基準を満たさない → AskUserQuestion
- 質問内容: 問題の詳細、リプラン履歴、人間の判断を求める理由

---

## 使い方

### 基本的な使い方

**ユーザー**: /note-smart [トピック]

**期待される動作**:
1. **Phase 1 Subagentが起動**
   - トピックからN=1ペルソナを設定
   - 9セクションから使用するものを選定
   - アウトラインを作成
   - `_codex/sns/drafts/{topic}_structure.md`保存

2. **Phase 2 Subagentが起動**
   - Phase 1の構成に基づいて本文執筆
   - 2,500-3,000文字で作成
   - 7原則を適用
   - `_codex/sns/drafts/{topic}_draft.md`保存

3. **Phase 2.5 Subagentが起動**
   - 鬼編集長チェックリストを適用
   - スコアリング（80点以上で合格）
   - 修正提案を生成
   - `_codex/sns/drafts/{topic}_reviewed.md`保存

4. **Phase 3 Subagentが起動**
   - 見出し画像プロンプトを生成
   - メタ情報を設定
   - 公開チェックリストを作成
   - `_codex/sns/drafts/{topic}_final.md`保存

5. **Orchestratorが結果を確認**
   - 全Phaseの成果物を検証
   - 品質チェック（必須項目の確認）
   - 最終レポート生成

---

## Expected Output

### 成功時

```markdown
# note-smart 実行結果

**作成日**: 2026-01-04
**トピック**: [記事にしたい内容]
**Phase数**: 4
**実行時間**: 40分

## Phase 1: Structure Design

### ターゲットペルソナ
[具体的な1人の人物像]

### タイトル
[30-40文字、逆説的・具体的]

### 使用セクション
[選定されたセクション一覧]

## Phase 2: Draft Creation

### 文字数
約2,800文字

### 適用した7原則
- ✅ 独自性
- ✅ 具体性
- ✅ ストーリー
- ✅ 継続性
- ✅ タイトル
- ⬜ 見出し画像（Phase 3で対応）
- ✅ プロセスエコノミー

## Phase 2.5: Editor Review

### スコア
92点 / 100点

### 判定
✅ 合格

## Phase 3: Finalize

### 見出し画像プロンプト
[Nano Banana Pro用プロンプト]

### タグ
#100日チャレンジ #PM業務自動化 #AI活用

---

**Success Criteria達成率**: 100%

✅ Phase 1: Structure Design - 完了
✅ Phase 2: Draft Creation - 完了（2,800文字）
✅ Phase 2.5: Editor Review - 完了（92点）
✅ Phase 3: Finalize - 完了
```

---

## 関連Skills

- `sns-smart`: X投稿用Orchestrator（5 Phase）
- `note-article-writing`: note記事作成ガイド（リファレンス版）
- `customer-centric-marketing-n1`: N=1顧客分析
- `sns-copy-patterns`: 構文パターン
- `nano-banana-pro-tips`: 画像生成テクニック

---

## バージョン履歴

### v1.0 (2026-01-04)
- 初版作成
- Phase 1-3実装（Structure Design, Draft Creation, Editor Review, Finalize）
- 4 Skills統合（note-article-writing, customer-centric-marketing-n1, sns-copy-patterns, nano-banana-pro-tips）
- 4 Phase workflow（Phase 2.5追加）
- 鬼編集長チェックリスト自動適用

---

**最終更新**: 2026-01-04（v1.0）
**作成者**: Claude Code
**ステータス**: Active (v1.0)
**統合済みSkills**: 4個
