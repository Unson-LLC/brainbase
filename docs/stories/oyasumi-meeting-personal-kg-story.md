---
story_id: str.brainbase.oyasumi-meeting-personal-kg
title: Oyasumi meeting minutes to Personal KG
status: active
date: 2026-05-16
reason: "/oyasumi が当日議事録をGraph/Wiki/NocoDBへ反映するだけでなく、SNS生成Contextで使える owner-visible personal KG candidate へ戻すStory。2026-05-15 SalesTailor/エクネス関連議事録が本番memory_candidatesへ入っておらず、次の投稿生成で使えないことを確認したため。"
related_specs:
  - SPEC-oyasumi-meeting-personal-kg
  - SPEC-candidate-store-mvp
  - SPEC-sns-learning-informed-generation
  - SPEC-personal-kg-sns-seed-mvp
related_stories:
  - str.brainbase.sns-learning-informed-generation
  - str.brainbase.personal-kg-sns-seed-mvp
  - story-candidate-store-cross-repo-write
source_context:
  - .claude/commands/oyasumi.md
  - .claude/skills/daily-reflection/SKILL.md
  - server/sql/candidate-store-schema.sql
  - server/services/sns/sns-generation-context-service.js
  - docs/architecture/ADR-011-sns-posting-ledger-boundary.md
example_sources:
  - Unson-LLC/salestailor-project:meetings/minutes/2026-05-15_business-ai-future-dinner-meeting.md
  - Unson-LLC/salestailor-project:meetings/minutes/2026-05-15_social-gathering-business-networking-talk.md
---

# Story: Oyasumi meeting minutes to Personal KG

## User Story

SNS運用と個人KGを運用するさとけいとして、
`/oyasumi` が当日の議事録から、判断OSとして再利用できる思想・実績・営業哲学・読者理解・背景事情を owner-visible personal KG core candidateへ戻してほしい。
そうすれば、会議や飲み会で得た一次情報が翌朝のSNS生成Contextだけでなく、今後のAI判断で「なぜ佐藤圭吾ならそう考えるか」を再現する材料になる。

## Context

2026-05-16時点で、SNS生成Contextは本番 `brainbase_ssot.memory_candidates` の owner-visible personal KG candidate を読める。
一方で、`/oyasumi` の日次振り返りは設計上、議事録をGraph/Wiki/NocoDBへ反映することになっているが、SNS生成に使う `memory_candidates` へ当日議事録の学習候補を作る経路がまだない。

実例として、2026-05-15 の SalesTailor 議事録には以下が存在する。

- `2026-05-15_business-ai-future-dinner-meeting.md`
- `2026-05-15_social-gathering-business-networking-talk.md`

しかし本番確認では、`memory_candidates` に `2026-05-15` / `エクネス` / 該当slug由来のcandidateはなかった。
この状態では、次のSNS投稿生成は昨日の一次情報を使えない。

## Business Context

brainbase SNS運用の価値は「AIが投稿文を書く」ことではない。
価値は、会議、商談、飲み会、プロダクト開発、顧客反応から生まれた一次情報を個人KGに蓄積し、必要に応じて安全なSNS projectionへ変換できることにある。

`/oyasumi` はその日の活動を「片付ける」コマンドではなく、翌日の発信品質と以後のAI判断品質を上げるための記憶化フェーズである。

## Scope

- `/oyasumi YYYY-MM-DD` が、対象日のmana議事録を取得・抽出したあと、SNSに使えるpersonal KG candidateを作る。
- candidateは `memory_candidates` に、署名検証済み会社権限context由来の `owner_person_id`, `visibility=owner`, `promotion_status=candidate` として保存する。
- candidateは議事録全体をそのまま入れず、SNS生成に使える単位へ圧縮する。
  - `philosophy`: さとけいの思想として再利用できる主張
  - `sales_philosophy`: SalesTailor/営業/信頼形成に関する思想
  - `proof`: 実績・数字・具体的な自社経験
  - `operating_principle`: AI活用、営業、PM、組織運用に関する判断基準
  - `persona_understanding`: 読者や顧客がどう感じるかの理解
- SNSやteam/org共有に使ってはいけない私的・センシティブ情報は `sns_ready` / team / org projection へ流さない。
- `personal_kg_core` には、佐藤圭吾本人の判断再現に不可欠な場合のみ、owner-visible + sensitivity tag + provenance付きで詳細を保持できる。
- candidateは `source_event_ids` と `evidence_ref` 相当のmetadataで、repo/path/date/slugへ戻れる。
- 次回の `sns_generation_context.json` は、作成されたcandidateを `personal_kg.anchors` / `proof_points` / `candidate_sources` に含められる。

## Non-goals

- 議事録全文をGraphやSNS Contextへ流し込まない。
- 家族、医療、健康、個人のプライバシー、相手の未公開事情をSNS素材・チーム共有・組織正本へ無加工で変換しない。
- Graph SSOTへraw議事録を直接書かない。
- `content_pillars.md` やSNS戦略OSを毎日自動で書き換えない。
- X投稿、scheduler、SNS UIの状態管理はこのStoryでは変えない。
- 顧客・パートナーWikiの新規登録を議事録だけで断定しない。外部組織は公式情報確認を維持する。

## Acceptance Criteria

- [ ] AC-1: `/oyasumi YYYY-MM-DD` から、対象日のmana議事録を検出し、personal KG candidate化対象を抽出できる。
- [ ] AC-2: 2026-05-15 SalesTailor議事録を入力した場合、AI活用、営業代行、信頼形成、SalesTailor実績に関するcandidateが作られる。
- [ ] AC-3: 家族、医療、健康、個人の私的事情は `sns_ready` には出ず、SNS生成Contextにも出ない。
- [ ] AC-3b: 判断再現に必要なprivate/confidential detailsは `personal_kg_core` に owner-visible + sensitivity tag + provenance付きで保持できる。
- [ ] AC-4: candidateは署名検証済み会社権限context由来の `owner_person_id` と `organization_id`, `visibility=owner`, `sensitivity` 適切値、`project_code` 適切値、`source_system=oyasumi-meeting-personal-kg` を持つ。自己申告identityと未検証の委任IDは拒否する。
- [ ] AC-5: candidateの `source_event_ids` から、GitHub repo/path/date/slugへ戻れる。
- [ ] AC-6: 同じ議事録を再処理しても重複candidateを作らない。
- [ ] AC-7: `sns_generation_context.json` は新規candidateを `personal_kg.candidate_sources` に含め、使えるものを `anchors` / `proof_points` へ分類する。
- [ ] AC-8: SNS draft生成は、candidate由来の情報を「昨日の飲み会で」などの運用露出ではなく、読者に価値がある思想・具体例として使う。
- [ ] AC-9: extraction結果には、採用/除外/要人間確認の件数と理由が残る。
- [ ] AC-10: production dry-runで、2026-05-15 SalesTailor議事録からcandidate候補が作られ、actual write前に差分をレビューできる。

## Data Boundary

`oyasumi-meeting-personal-kg` は Raw Ledger 互換のcandidate writerであり、Graph SSOTではない。

- mana議事録: 入力source。議事録は参考情報であり、外部組織・人物の正本確認には使い切らない。
- candidate-store: SNS生成が読む個人KG cognitive memoryの正本。
- Graph/Wiki: 人物、組織、顧客、Decisionの正本。外部組織は公式情報確認を維持する。
- SNS Generation Context: candidate-storeなどを合成した再生成可能なprojection。

## Candidate Shape

```json
{
  "source_system": "oyasumi-meeting-personal-kg",
  "source_event_ids": [
    "github:Unson-LLC/salestailor-project:meetings/minutes/2026-05-15_social-gathering-business-networking-talk.md#sales_philosophy:ai-sales-agency"
  ],
  "owner_person_id": "<verified context.scope.owner_person_id>",
  "project_code": "salestailor",
  "visibility": "owner",
  "sensitivity": "internal",
  "cognitive_type": "insight",
  "body": "AI活用支援の相談は月20万から半年500万円規模まで幅があり、営業代行で現金化しながら自社プロダクトの導入機会を作る動線がある。",
  "metadata": {
    "meeting_date": "2026-05-15",
    "repo": "Unson-LLC/salestailor-project",
    "path": "meetings/minutes/2026-05-15_social-gathering-business-networking-talk.md",
    "category": "sales_philosophy",
    "extraction_decision": "adopted"
  }
}
```

## Scenarios

### S-1: 昨日のSalesTailor議事録が翌朝の投稿素材になる

- given: 2026-05-15 のSalesTailor議事録がGitHubに存在する
- when: `/oyasumi 2026-05-15` を実行する
- then: 営業、AI活用、信頼形成、実績に関するpersonal KG candidateが作られる
- and: 次回 `sns_generation_context.json` にcandidate sourceとして現れる

### S-2: 私的・医療情報はSNS素材にしない

- given: 議事録に家族や医療の私的な話題が含まれる
- when: personal KG candidateを抽出する
- then: SNS projectionでは `rejected_private_or_sensitive` として記録され、`sns_ready` bodyには入らない
- and: 佐藤の判断再現に不可欠な場合のみ `personal_kg_core` に owner-visible + sensitivity tag 付きで残る

### S-3: 重複投入しない

- given: 同じ議事録を前日に処理済みである
- when: `/oyasumi 2026-05-15` を再実行する
- then: `source_system + owner_person_id + source_event_ids` で既存candidateを検出し、新規重複を作らない

### S-4: 投稿には運用都合を出さない

- given: candidateが「飲み会」「同席」「営業代行」由来である
- when: SNS draft生成がcandidateを使う
- then: 投稿本文は運用裏側を説明せず、読者に価値がある一般化された思想・具体例として使う

## Task Candidates

| ID | Type | Title | Notes |
|---|---|---|---|
| TSK-oyasumi-kg-001 | SPEC | Meeting-to-personal-KG extraction spec | 抽出カテゴリ、除外カテゴリ、source provenance、重複キー |
| TSK-oyasumi-kg-002 | BE/OPS | Oyasumi meeting candidate extractor | mana議事録からcandidate候補を作る |
| TSK-oyasumi-kg-003 | BE | Candidate writer contract | PgCandidateRepository経由でwrite、dry-run対応 |
| TSK-oyasumi-kg-004 | SAFETY | Privacy/sensitivity guard | 家族/医療/私的事情/未公開顧客事情の除外 |
| TSK-oyasumi-kg-005 | INTEGRATION | SNS Generation Context handoff | 新規candidateがanchors/proof_pointsへ分類される |
| TSK-oyasumi-kg-006 | OPS | Oyasumi command integration | `/oyasumi` Phase 3-7に候補作成とサマリを追加 |

## Verification Plan

- Unit: SalesTailor 2026-05-15 sample minutesからcandidate候補を抽出できる。
- Unit: 家族/医療/私的事情が `sns_ready` candidate化されない。
- Unit: sensitiveな `personal_kg_core` がowner以外のretrievalで返らない。
- Unit: source provenanceと重複キーが安定している。
- Integration: dry-runではDB writeせず、adopted/rejected/needs_review件数を返す。
- Integration: production DB write後、`scripts/build-sns-generation-context.js` がcandidate_sourcesに `oyasumi-meeting-personal-kg` を含める。
- Regression: 既存のSNS feedback learning candidate、seed personal KG、posting ledgerの挙動を壊さない。
