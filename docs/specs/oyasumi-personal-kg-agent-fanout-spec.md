---
spec_id: SPEC-oyasumi-personal-kg-agent-fanout
story_id: str.brainbase.oyasumi-personal-kg-agent-fanout
title: Oyasumi Personal KG agent fan-out
status: draft
date: 2026-05-16
---

# SPEC: Oyasumi Personal KG agent fan-out

## Purpose

`/oyasumi` のpersonal KG処理を、直列の薄いSNS要約から、role-based agent fan-out/fan-inへ変える。
minutes/transcriptからSNS化前の個人KG coreを作り、その後にSNS利用可能なprojectionを作る。

## Invariants

- INV-1: coordinator outputは `agent_reports` を持つ。
- INV-2: `personal_kg_extractor` は `memory_layer=personal_kg_core` のcandidateを作る。
- INV-3: `sns_projection` は `memory_layer=sns_ready` のcandidateだけをSNS Generation Context向けに作る。
- INV-4: family/medical/private/counterparty confidentialは `sns_ready` candidate bodyへ入らない。
- INV-5: transcriptがある場合、extractorはminutesよりtranscriptを優先したsource refを持つcandidateを作れる。
- INV-6: candidateは `source_system=oyasumi-meeting-personal-kg`, `owner_person_id=sato_keigo`, `visibility=owner` を維持する。
- INV-7: `source_event_ids` は memory layer と rule id を含み、coreとprojectionの重複を独立に防げる。

## Agent Contract

```json
{
  "agent_reports": [
    {
      "role": "personal_kg_extractor",
      "status": "completed",
      "input_count": 2,
      "output_count": 8,
      "notes": []
    }
  ],
  "adopted": [],
  "rejected": [],
  "needs_review": []
}
```

## Candidate Snapshot Contract

```json
{
  "oyasumi_meeting_personal_kg": {
    "category": "operating_principle",
    "memory_layer": "personal_kg_core",
    "agent_role": "personal_kg_extractor",
    "source_kind": "transcript",
    "projection_of": null,
    "meeting_date": "2026-05-15",
    "rule_id": "brainbase-thinks-as-my-brain"
  }
}
```

## Scenarios

### S-1: transcriptから個人KG coreを抽出する

- given: transcriptにClaude Code/Codex使い分けや「俺の脳で考える」思想がある
- when: extractorを実行する
- then: `memory_layer=personal_kg_core` candidateが作られる
- and: `source_kind=transcript` が残る

### S-2: SNS projectionはcoreから分離される

- given: `personal_kg_core` candidateがある
- when: SNS projection agentが動く
- then: SNS利用可能なものだけ `memory_layer=sns_ready` として採用される

### S-3: sensitive情報はSNS readyへ流れない

- given: transcriptに家族・医療情報がある
- when: fan-out extractionを実行する
- then: `rejected` に理由が残り、`sns_ready` candidate bodyには含まれない

## Anti-patterns

- AP-1: `/oyasumi` coordinatorがcandidate本文を直接作る。
- AP-2: `sns_ready` だけを作り、`personal_kg_core` を残さない。
- AP-3: transcriptがあるのにminutes要約だけで抽出完了扱いにする。
- AP-4: agent reportなしに0件を成功扱いにする。

## Verification

- V-1: `agent_reports` contract unit test。
- V-2: transcript-derived core candidate unit test。
- V-3: `sns_ready` projection separation unit test。
- V-4: existing oyasumi/SNS context regression tests。
