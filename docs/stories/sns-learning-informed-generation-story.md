---
story_id: str.brainbase.sns-learning-informed-generation
title: SNS Learning Informed Generation
status: active
date: 2026-05-16
reason: "SNS生成の入力コンテキストを、個人KG・過去投稿統計・SNS戦略から組み立てるStory。新しいDB境界は後続Specで決めるため、このStory作成時点では新規ADRは不要。"
related_specs:
  - SPEC-sns-learning-informed-generation
  - SPEC-personal-kg-sns-weekly-planner
  - SPEC-sns-feedback-loop
  - SPEC-sns-x-algorithm-quality
related_stories:
  - str.brainbase.personal-kg-sns-weekly-planner
  - story-sns-posting-cockpit
  - str.brainbase.sns-x-algorithm-quality
  - str.brainbase.sns-ledger-live-refresh
source_context:
  - /Users/ksato/workspace/shared/_codex/sns/sns_strategy_os.md
  - /Users/ksato/workspace/shared/_codex/sns/content_pillars.md
  - server/sql/sns-posting-ledger-schema.sql
  - server/sql/candidate-store-schema.sql
---

# Story: SNS Learning Informed Generation

## User Story

brainbaseでSNS投稿を作るさとけいとして、
AIが毎朝の投稿生成時に、個人KG、過去投稿履歴と統計、SNS戦略を統合した生成コンテキストを読んでほしい。
そうすれば、昨日の反省を人間が眺めるだけではなく、蓄積された思想・実績・反応・戦略を踏まえた価値ある投稿案を作れる。

## Context

現状のSNS lineは、以下の部品を持ち始めている。

- Personal KG: さとけいの思想、実績、判断、議事録由来のmemoryをSNS sourceにできる。
- SNS Posting Ledger: review pack、投稿状態、posted URL、metrics snapshotsを持つ。
- Feedback Learning: posted recordをcandidate-storeへ戻す入口がある。
- SNS Strategy OS: `Persona Brain`、`Peer Circle`、`Own Proof`、週次配分、Tone Guard、Distribution Layersを持つ。
- X Algorithm Quality: draftごとにcandidate source、positive action、negative feedback risk、graph edge goalを持つ設計がある。

しかし、これらはまだ投稿生成時に1つの入力コンテキストとして統合されていない。
日次feedback markdownや人間向けAnalytics UIだけでは不十分である。
重要なのは、人間がトータル分析を見ることではなく、AIがトータル分析を踏まえて次の投稿を作れることである。

## Business Context

SNS運用の価値は「AIが投稿文を書く」ことではない。
価値は、brainbaseが持つ個人の思想・実績・関係性・過去反応・戦略を組み合わせて、読者の脳に届く投稿を継続的に作れることにある。

このStoryのセンターピンは、`ohayo` の投稿生成前に **SNS Generation Context** を構築することである。
これは人間向けダッシュボードではなく、AIが読むための構造化された作戦ブリーフである。

## Scope

- `ohayo` / SNS draft generation の前に、SNS Generation Contextを生成する。
- SNS Generation Contextは少なくとも以下を含む。
  - 個人KG source: 使うべき思想、実績、判断、proof、避けるべき誤読
  - SNS戦略: content pillars、tone guard、weekly mix、distribution layer、CTA方針
  - 投稿履歴統計: 7日/30日のlane別、source_type別、format別、persona_affect別、algorithm_fit別の反応傾向
  - 投稿単位の学習: learning candidate化済みの洞察、未候補化のposted metrics、publish_failed/skipped理由
  - 今日の生成制約: 増やすべきlane、避けるべき型、引用候補に求める条件、CTAの出しどころ
- `ohayo` は、単独のニュース/Peer候補だけでなく、SNS Generation Contextを入力にしてdaily review packを作る。
- ContextはAIが読みやすいJSONと、人間が必要時だけ確認できる短いmarkdown summaryを持つ。
- 投稿本文には、統計や運用都合を露出しない。分析は生成の裏側に閉じる。

## Non-goals

- 人間向けの詳細Analytics dashboardを主目的にしない。
- raw metricsをGraphへ直接書かない。
- 全投稿を自動で勝ち筋化しない。
- `content_pillars.md` や `sns_strategy_os.md` を毎日自動で書き換えない。
- 投稿実行、X API投稿、scheduler挙動はこのStoryでは変えない。

## Acceptance Criteria

- [ ] AC-1: `ohayo` 前に、対象日と直近期間から `sns_generation_context.json` を生成できる。
- [ ] AC-2: `sns_generation_context.json` は Personal KG source、SNS strategy、posting ledger stats、feedback learning candidatesを別セクションとして持つ。
- [ ] AC-3: 投稿履歴統計は直近7日/30日で集計され、lane / source_type / format / persona_affect / algorithm_fit の単位で比較できる。
- [ ] AC-4: Contextは「人間が見る分析」ではなく「AIが次の投稿を作るための制約」に変換され、`recommended_lanes`, `avoid_patterns`, `winning_angles`, `needs_more_data`, `quote_target_policy` を持つ。
- [ ] AC-5: `ohayo` の投稿生成は、このContextを読んで、週次配分と当日ニュース/Peer差し込みを両立する。
- [ ] AC-6: Persona Brainの気持ちがマイナスになる投稿、運用都合が見える投稿、AI投稿自動化感が出る投稿はContext上のavoid patternとして生成前に止まる。
- [ ] AC-7: 直近の投稿で反応が弱い型は、単純に捨てるのではなく、Personal KG anchorや読者の誤解に戻して別角度へ変換される。
- [ ] AC-8: `publish_failed`, `skipped`, `deleted` は失敗として雑に混ぜず、生成時の除外/再利用/修正判断に分類される。
- [ ] AC-9: learning candidate化済みのSNS feedbackは、次回生成時に「再利用可能な洞察」として参照され、未候補化のposted metricsとは区別される。
- [ ] AC-10: 生成されたreview packの各draftは、どのContext sectionを使ったかをevidenceに残す。

## Data Boundary

SNS Generation Contextはprojectionであり、正本ではない。

- Personal KG / candidate-store: 思想、実績、議事録由来memory、SNS feedback learning candidateの正本。
- SNS Posting Ledger: 投稿本文、状態、posted URL、metrics snapshotsの正本。
- SNS Strategy OS: content pillar、tone、週次配分、CTA方針の手書き正本。
- SNS Generation Context: 上記を日次生成のために合成した一時的/再生成可能な入力artifact。

## Proposed Output Shape

```json
{
  "date": "2026-05-16",
  "lookback": { "days_7": {}, "days_30": {} },
  "strategy": {
    "weekly_mix_target": {},
    "tone_guard": [],
    "distribution_layers": []
  },
  "personal_kg": {
    "anchors": [],
    "proof_points": [],
    "persona_misunderstandings": [],
    "avoid_exposures": []
  },
  "posting_stats": {
    "by_lane": {},
    "by_source_type": {},
    "by_format": {},
    "by_persona_affect": {},
    "by_algorithm_fit": {}
  },
  "learning": {
    "created_candidates": [],
    "pending_feedback": [],
    "publish_failed": [],
    "skipped": []
  },
  "generation_policy": {
    "recommended_lanes": [],
    "avoid_patterns": [],
    "winning_angles": [],
    "needs_more_data": [],
    "quote_target_policy": []
  }
}
```

## Scenarios

### S-1: ohayoが累積学習を読んで投稿を作る

- given: 過去7日分のLedger metricsとPersonal KG sourceがある
- when: `ohayo` がdaily review packを作る
- then: 直近の勝ち/弱さ/未検証を踏まえた `generation_policy` が先に作られ、draftはそのpolicyのevidenceを持つ

### S-2: 人間向け分析UIなしでもAIが使える

- given: 人間がAnalytics dashboardを開かない
- when: `ohayo` が実行される
- then: `sns_generation_context.json` を読み、昨日だけでなく7日/30日の傾向を使う

### S-3: 反応が弱い型を単純に捨てない

- given: `trust_balance` のimpressionが低いがbookmark/profile_clickが相対的に強い
- when: 次のdraftを作る
- then: `trust_balance` を捨てず、よりPersona Brainに近い具体例やPersonal KG proofに寄せた角度を提案する

### S-4: 失敗状態を生成制約へ変換する

- given: 前日に `publish_failed` と `skipped` がある
- when: Contextを生成する
- then: publish_failedは運用再試行/破棄判断、skippedは再利用禁止または修正対象として分類され、勝ち筋統計には混ぜない

## Task Candidates

| ID | Type | Title | Notes |
|---|---|---|---|
| TSK-sns-learning-gen-001 | SPEC | SNS Generation Context spec | 正本境界、JSON shape、集計単位を定義 |
| TSK-sns-learning-gen-002 | BE/OPS | Context builder | Ledger + candidate-store + strategy files + Personal KG readerを統合 |
| TSK-sns-learning-gen-003 | OPS | oyasumi stats update | posted metricsをlearning_ready/candidate化し、次回Context用に整える |
| TSK-sns-learning-gen-004 | OPS | ohayo context input | daily brief生成前にContextを読み、生成方針へ反映 |
| TSK-sns-learning-gen-005 | TEST | Contract tests | 7日/30日集計、失敗状態除外、evidence preservation |

## Verification Plan

- Unit: Ledger recordsから7日/30日のlane/source/format/persona/algorithm集計を作れる。
- Unit: posted+metrics / learning_ready / publish_failed / skipped / deleted を別分類にできる。
- Unit: SNS strategy filesとPersonal KG anchorsをContextへ入れられる。
- Integration: `ohayo` review pack生成時にContext evidenceがdraftへ残る。
- Regression: review pack import、SNS UI、posting、metrics pollingの既存挙動を変えない。
