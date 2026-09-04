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
- INV-4: `personal_kg_core` は判断再現に必要な family/medical/private/counterparty confidential details を保持してよい。ただし owner-visible, sensitivity tagged, provenance linked, retrieval-purpose gated でなければならない。
- INV-4b: family/medical/private/counterparty confidential details は `sns_ready`, `team_candidate`, `org_candidate`, Graph promotion body へそのまま入らない。
- INV-5: transcriptがある場合、extractorはminutesよりtranscriptを優先したsource refを持つcandidateを作れる。
- INV-6: candidateは `source_system=oyasumi-meeting-personal-kg`, 署名検証済み会社権限contextの `scope.owner_person_id`, `visibility=owner` を維持する。CLI引数や本文の人物IDをownerとして採用しない。
- INV-6a: 署名検証済みの委任証明を検証する実装がない間、ownerとactorが異なるPersonal KG操作はfail-closedで拒否する。委任ID文字列だけでは許可しない。
- INV-7: `source_event_ids` は memory layer と rule id を含み、coreとprojectionの重複を独立に防げる。
- INV-8: projection/promotion は元の `personal_kg_core` を上書きせず、別instance + provenance (`projection_of` / `derived_from`) として作る。

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
    "rule_id": "brainbase-thinks-as-my-brain",
    "retrieval_purpose": "owner_judgment",
    "projection_allowed": false,
    "projection_gate": "redact_or_approve_before_sns_team_org",
    "promotion_scope_candidate": ["personal", "team_candidate"],
    "sensitivity_reason": "counterparty_confidential_business_context"
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

### S-3: sensitive情報はpersonal coreに残せるがSNS readyへ流れない

- given: transcriptに家族・医療情報がある
- when: fan-out extractionを実行する
- then: 判断再現に必要なら `personal_kg_core` に owner-visible + sensitivity tag 付きで残せる
- and: `sns_ready` candidate bodyには含まれない
- and: projection outputは `rejected` / `needs_review` に理由を残す

### S-4: team/org promotionは別instanceになる

- given: `personal_kg_core` に相手未公開事情を含む判断材料がある
- when: team/orgへ昇格候補を作る
- then: 元candidateを上書きしない
- and: redaction/approval済みの別instanceを作る
- and: `projection_of` / `derived_from` で元candidateへ戻れる

## Anti-patterns

- AP-1: `/oyasumi` coordinatorがcandidate本文を直接作る。
- AP-2: `sns_ready` だけを作り、`personal_kg_core` を残さない。
- AP-3: transcriptがあるのにminutes要約だけで抽出完了扱いにする。
- AP-4: agent reportなしに0件を成功扱いにする。
- AP-5: `personal_kg_core` の詳細を消して、後から佐藤の判断理由を復元できなくする。
- AP-6: sensitiveなcore candidateをredactionなしでSNS/team/orgへ投影する。

## Verification

- V-1: `agent_reports` contract unit test。
- V-2: transcript-derived core candidate unit test。
- V-3: `sns_ready` projection separation unit test。
- V-4: existing oyasumi/SNS context regression tests。
- V-5: owner-only retrieval testで sensitive `personal_kg_core` が本人以外に返らない。
- V-6: projection testで `needs_redaction` / confidential candidate がSNS/team/org bodyにそのまま出ない。
