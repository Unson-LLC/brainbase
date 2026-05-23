---
story_id: str.brainbase.oyasumi-personal-kg-agent-fanout
title: Oyasumi Personal KG agent fan-out
status: active
date: 2026-05-16
reason: "/oyasumi にGraph/Wiki/NocoDB/SNS feedback/personal KG集約がまとまりすぎ、個人KG抽出がSNS用の薄い要約へ潰れる懸念が出たため。"
related_specs:
  - SPEC-oyasumi-personal-kg-agent-fanout
  - SPEC-oyasumi-meeting-personal-kg
  - SPEC-candidate-store-mvp
related_stories:
  - str.brainbase.oyasumi-meeting-personal-kg
  - str.brainbase.personal-kg-sns-seed-mvp
source_context:
  - .claude/commands/oyasumi.md
  - scripts/oyasumi-meeting-personal-kg.js
  - server/services/sns/oyasumi-meeting-personal-kg-service.js
  - server/services/sns/sns-generation-context-service.js
---

# Story: Oyasumi Personal KG agent fan-out

## User Story

個人KGを運用するさとけいとして、
`/oyasumi` が巨大な直列作業として個人KG集約を片手間に行うのではなく、会議単位・役割単位の専門agentへfan-outしてほしい。
そうすれば、議事録やtranscriptから思想・仮説・判断基準・実績が落ちず、翌朝のSNS生成や今後のAI判断に使える記憶が残る。

## Context

既存の `oyasumi-meeting-personal-kg` は、議事録本文に正規表現ルールを当てて `sns_ready` に近いcandidateを作る。
この実装は安全だが、以下の問題がある。

- `/oyasumi` がGraph/Wiki/NocoDB/archive/SNS feedback/personal KGまで抱えている。
- meeting extractionが直列で、役割境界がない。
- minutes中心で、transcriptにある思想や判断基準が落ちる。
- personal KG core と SNS projection が分離されず、投稿に使いやすい短文だけが残る。

## Business Context

brainbase SNS運用の価値は、X投稿文をAIで作ることではなく、会議・商談・開発・顧客反応から佐藤圭吾の判断基準を個人KGへ戻し、翌日以降のAI判断品質を上げることにある。
このStoryは、日次運用で一次情報が薄いSNS要約へ潰れる失敗を減らし、個人判断・投稿生成・顧客理解・プロダクト思想の再利用率を上げる。

## Business Metric

- `/oyasumi` dry-runで `agent_reports` が必ず出る。
- transcriptあり会議から `personal_kg_core` が0件になった場合、成功扱いにしない。
- 2026-05-15 SalesTailor実データで、minutes由来の `sns_ready` に加えて transcript由来の `personal_kg_core` が作られる。

## Scope

- `/oyasumi` personal KG handoffを coordinator + agent reports の構造にする。
- meeting単位の抽出をfan-out/fan-in可能な契約にする。
- agent roleを少なくとも以下に分ける。
  - `meeting_harvester`: minutes/transcript/source metadataを集める。
  - `personal_kg_extractor`: SNS化前の個人KG coreを抽出する。
  - `sensitivity_reviewer`: owner_judgment / sns_allowed / team_allowed / org_allowed を分離する。
  - `sns_projection`: SNS生成Contextで使えるcandidateへ投影する。
- `personal_kg_core` を permission snapshot に明示し、`sns_ready` だけの抽出を禁止する。
- `personal_kg_core` は判断再現に必要なprivate/confidential detailsを保持してよい。ただしowner-visible、sensitivity tag、retrieval purpose、provenanceを必須にする。
- `sns_ready` / team / org projection は `personal_kg_core` を上書きせず、redaction/approval済みの別instanceとして作る。
- transcriptが渡された場合は transcript を一次入力、minutesを補助入力として扱う。

## Non-goals

- 外部LLM APIを必須にしない。
- X投稿、scheduler、SNS UIを変更しない。
- Graph SSOTへcandidateを直接promoteしない。
- 私的・医療・相手先未公開情報をSNS素材化しない。
- `personal_kg_core` の詳細をteam/orgへ自動昇格しない。

## Acceptance Criteria

- [ ] AC-1: extractor outputに `agent_reports` が含まれ、role別の入力件数・出力件数・statusがわかる。
- [ ] AC-2: `personal_kg_extractor` は `personal_kg_core` candidateを作り、SNS projection前の記憶単位を残す。
- [ ] AC-3: `sns_projection` は `personal_kg_core` のうちSNS利用可能なものだけを `sns_ready` candidateとして出す。
- [ ] AC-4: transcript本文が渡された場合、minutesにないClaude Code/Codex運用思想や「俺の脳で考える」思想をcandidate化できる。
- [ ] AC-5: sensitivity reviewerはfamily/medical/counterparty confidentialを `personal_kg_core` に保持してよいか、`sns_ready` / team / org projectionから除外すべきかを分離し、`rejected` / `needs_review` に理由を残す。
- [ ] AC-8: `personal_kg_core` の confidential details は owner-only retrieval では使えるが、SNS/team/org retrieval ではredaction済みprojectionしか返らない。
- [ ] AC-6: 同じsource_event_idを再処理しても重複candidateを作らない。
- [ ] AC-7: `/oyasumi` commandはpersonal KG handoffを「Coordinatorがagent fan-out/fan-inする」工程として説明する。

## Verification Plan

- Unit: transcript-only思想が `personal_kg_core` として抽出される。
- Unit: `agent_reports` がrole別に出る。
- Unit: sensitive内容が `sns_ready` へ流れない。
- Unit: sensitive `personal_kg_core` はowner-only retrievalでのみ返る。
- Regression: 既存のSalesTailor minutes抽出、重複skip、SNS Generation Context連携が壊れない。
