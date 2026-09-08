---
spec_id: SPEC-oyasumi-meeting-personal-kg
story_id: str.brainbase.oyasumi-meeting-personal-kg
title: Oyasumi meeting minutes to Personal KG
status: draft
date: 2026-05-16
---

# SPEC: Oyasumi meeting minutes to Personal KG

## Purpose

`/oyasumi`で収集した当日議事録から、owner-visible personal KG core candidate を作る。
議事録をそのまま投稿素材化するのではなく、さとけいの思想、実績、営業哲学、読者理解、判断再現に必要な背景情報として再利用できる粒度へ変換する。

SNS生成Contextは personal KG core を直接公開利用せず、別の `sns_ready` projection だけを読む。

## Invariants

- INV-1: candidateは署名検証済み会社権限contextの `scope.owner_person_id` かつ `visibility=owner` で作る。CLI引数、環境変数、議事録本文の人物IDをownerとして採用しない。
- INV-1a: ownerとactorが異なる操作は、署名検証済みの委任証明を検証できるまでfail-closedで拒否する。委任ID文字列だけでは許可しない。
- INV-2: candidateの `source_system` は `oyasumi-meeting-personal-kg` とする。
- INV-3: `source_event_ids` はGitHub repo/path/date/slug/categoryを含み、同一議事録・同一抽出単位の重複投入を防げる。
- INV-4: `personal_kg_core` は判断再現に必要な confidential/private/counterparty details を保持してよい。ただし `visibility=owner`, `sensitivity`, `redaction_status`, provenance, retrieval purpose を必ず持つ。
- INV-5: 外部組織・顧客・人物の正本更新はGraph/Wiki側の確認ルールに従い、議事録だけで断定しない。
- INV-6: SNS Generation Contextはcandidate-storeを読むprojectionであり、raw議事録を直接読む正本にはしない。
- INV-7: `sns_ready`, `team_candidate`, `org_candidate`, Graph SSOT promotion では family/medical/private/counterparty confidential details をそのままbodyへ入れない。必要に応じて抽象化・redaction・approval済みの別instanceを作る。

## Memory Layers

| layer | Purpose | Detail Policy | Read Policy |
|---|---|---|---|
| `personal_kg_core` | 佐藤圭吾の判断OSを再現するためのowner-visible記憶 | 判断に必要な詳細を保持してよい。confidential/privateはtag必須 | `owner_judgment` のみ詳細取得可 |
| `sns_ready` | SNS生成Contextで使う公開可能projection | 私的・医療・相手未公開事情・契約詳細を除去/抽象化 | `sns_generation` のみ |
| `team_candidate` | チーム共有候補 | チーム合意可能な範囲へ要約。未公開詳細はapproval/redaction | `team_context` のみ |
| `org_candidate` | 組織Decision/Policy/Philosophy昇格候補 | 組織合意済み・検証済みの形へ別instance化 | `org_policy` のみ |

## Candidate Categories

| category | cognitive_type | Default layer | Projection destination | Description |
|---|---|---|---|---|
| `philosophy` | `claim` | `personal_kg_core` | `personal_kg.anchors` | さとけいの思想として一般化できる主張 |
| `sales_philosophy` | `insight` | `personal_kg_core` | `personal_kg.anchors` | SalesTailor/営業/信頼形成に関する再利用可能な洞察 |
| `proof` | `result` | `personal_kg_core` | `personal_kg.proof_points` | 数字、実績、PR、顧客導入などの証拠 |
| `operating_principle` | `preference` | `personal_kg_core` | `personal_kg.anchors` | AI活用、PM、営業運用の判断基準 |
| `persona_understanding` | `hypothesis` | `personal_kg_core` | `personal_kg.anchors` | 読者や顧客がどう感じるかの仮説 |

## Guard Categories

| guard | Personal core policy | Projection/promotion policy |
|---|---|---|
| `private_or_family` | 佐藤の判断再現に不可欠な場合のみ owner-visible + restricted/confidential で保持可 | `sns_ready` / team / org body には出さない |
| `medical_or_health` | 判断再現に不可欠な場合のみ owner-visible + restricted/confidential で保持可 | `sns_ready` / team / org body には出さない |
| `counterparty_confidential` | 判断再現に必要なら owner-visible + confidential/contract + needs_redaction で保持可 | approval/redaction済み別instance以外に昇格しない |
| `raw_social_context` | 判断や人物理解に必要なら背景として保持可 | 投稿や共有時は運用裏側を出さず思想・具体例へ抽象化 |
| `insufficient_context` | source/evidence が弱い場合は `needs_review` または破棄 | 昇格不可 |

## Contract

### Input

```json
{
  "date": "2026-05-15",
  "meetings": [
    {
      "repo": "Unson-LLC/salestailor-project",
      "path": "meetings/minutes/2026-05-15_social-gathering-business-networking-talk.md",
      "html_url": "https://github.com/Unson-LLC/salestailor-project/blob/main/meetings/minutes/2026-05-15_social-gathering-business-networking-talk.md",
      "sha": "1b7c3f999a0a0f8bb339cee62c06353b02c3dafa",
      "project_code": "salestailor",
      "content": "..."
    }
  ],
  "dry_run": true
}
```

### Output

```json
{
  "date": "2026-05-15",
  "source_system": "oyasumi-meeting-personal-kg",
  "adopted": [
    {
      "source_event_ids": [
        "github:Unson-LLC/salestailor-project:meetings/minutes/2026-05-15_social-gathering-business-networking-talk.md#sales_philosophy:ai-sales-agency"
      ],
      "owner_person_id": "<verified context.scope.owner_person_id>",
      "project_code": "salestailor",
      "visibility": "owner",
      "sensitivity": "internal",
      "cognitive_type": "insight",
      "memory_layer": "personal_kg_core",
      "projection_allowed": false,
      "body": "AI活用支援の相談は月20万から半年500万円規模まで幅があり、営業代行で現金化しながら自社プロダクトの導入機会を作る動線がある。",
      "metadata": {
        "meeting_date": "2026-05-15",
        "repo": "Unson-LLC/salestailor-project",
        "path": "meetings/minutes/2026-05-15_social-gathering-business-networking-talk.md",
        "category": "sales_philosophy",
        "retrieval_purpose": "owner_judgment",
        "projection_gate": "redact_before_sns"
      }
    }
  ],
  "rejected": [
    {
      "reason": "not_projectable_medical_or_health",
      "source_ref": "github:Unson-LLC/salestailor-project:meetings/minutes/2026-05-15_social-gathering-business-networking-talk.md#section:family"
    }
  ],
  "needs_review": []
}
```

## Scenarios

### S-1: SalesTailor議事録からSNS用candidateを作る

- given: `2026-05-15_social-gathering-business-networking-talk.md` が入力される
- when: extractorをdry-runで実行する
- then: AI活用、営業代行、信頼形成に関するcandidate候補が `adopted` に入る
- and: 家族・医療情報は `sns_ready` projection では `rejected` に入る
- and: 佐藤の判断再現に不可欠な場合だけ `personal_kg_core` に owner-visible + sensitivity tag 付きで残る

### S-2: 同一議事録を再実行しても重複しない

- given: 同じ `source_event_ids` のcandidateが既に存在する
- when: write modeで再実行する
- then: 既存candidateを検出し、同じbodyの新規rowを作らない

### S-3: SNS Generation Contextへ渡る

- given: `oyasumi-meeting-personal-kg` sourceのcandidateがDBにある
- when: `scripts/build-sns-generation-context.js --date YYYY-MM-DD` を実行する
- then: `personal_kg.candidate_sources` にsource_systemが現れる
- and: adopted candidateがcategoryに応じて `anchors` または `proof_points` に分類される

## Anti-patterns

- AP-1: 議事録全文を1 candidateとして保存する。
- AP-2: 「飲み会で話した」という運用文脈をそのまま投稿本文に出す。
- AP-3: `sns_ready` / team / org projection に家族・医療・私的事情をそのまま使う。
- AP-4: 外部組織の正本情報を議事録だけで作る。
- AP-5: extraction失敗時に黙って0件成功扱いにする。
- AP-6: `personal_kg_core` から詳細を落としすぎ、後から判断理由を復元できない。

## Verification

- V-1: sample SalesTailor minutesで `adopted` / `rejected` / `needs_review` が分かれる。
- V-2: privacy guard testで家族・医療情報が `sns_ready` / team / org projection bodyへ入らない。
- V-3: duplicate guard testで同じ `source_event_ids` の再投入が発生しない。
- V-4: dry-run integrationでproduction writeせず候補差分を表示できる。
- V-5: write後のContext integrationで `oyasumi-meeting-personal-kg` が `candidate_sources` に出る。
- V-6: owner-only retrieval testで `personal_kg_core` の confidential details が本人以外に返らない。
