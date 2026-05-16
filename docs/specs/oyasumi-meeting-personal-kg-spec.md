---
spec_id: SPEC-oyasumi-meeting-personal-kg
story_id: str.brainbase.oyasumi-meeting-personal-kg
title: Oyasumi meeting minutes to Personal KG
status: draft
date: 2026-05-16
---

# SPEC: Oyasumi meeting minutes to Personal KG

## Purpose

`/oyasumi`で収集した当日議事録から、SNS生成Contextで使える owner-visible personal KG candidate を作る。
議事録をそのまま投稿素材化するのではなく、さとけいの思想、実績、営業哲学、読者理解として再利用できる粒度へ変換する。

## Invariants

- INV-1: candidateは `owner_person_id=sato_keigo` かつ `visibility=owner` で作る。
- INV-2: candidateの `source_system` は `oyasumi-meeting-personal-kg` とする。
- INV-3: `source_event_ids` はGitHub repo/path/date/slug/categoryを含み、同一議事録・同一抽出単位の重複投入を防げる。
- INV-4: 家族、医療、健康、私的事情、未公開の相手事情はcandidate bodyへ入れない。
- INV-5: 外部組織・顧客・人物の正本更新はGraph/Wiki側の確認ルールに従い、議事録だけで断定しない。
- INV-6: SNS Generation Contextはcandidate-storeを読むprojectionであり、raw議事録を直接読む正本にはしない。

## Candidate Categories

| category | cognitive_type | SNS context destination | Description |
|---|---|---|---|
| `philosophy` | `claim` | `personal_kg.anchors` | さとけいの思想として一般化できる主張 |
| `sales_philosophy` | `insight` | `personal_kg.anchors` | SalesTailor/営業/信頼形成に関する再利用可能な洞察 |
| `proof` | `result` | `personal_kg.proof_points` | 数字、実績、PR、顧客導入などの証拠 |
| `operating_principle` | `preference` | `personal_kg.anchors` | AI活用、PM、営業運用の判断基準 |
| `persona_understanding` | `hypothesis` | `personal_kg.anchors` | 読者や顧客がどう感じるかの仮説 |

## Rejection Categories

| rejection | Rule |
|---|---|
| `private_or_family` | 家族、家族構成、個人的な近況は除外する |
| `medical_or_health` | 医療、健康、病気、手術などは除外する |
| `counterparty_confidential` | 相手企業の未公開事情、未公開予算、未公開案件は除外または要人間確認にする |
| `raw_social_context` | 飲み会、同席、雑談などの場の説明だけではcandidate化しない |
| `insufficient_context` | 出典や意味が弱く、投稿素材として一般化できないものは除外する |

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
      "owner_person_id": "sato_keigo",
      "project_code": "salestailor",
      "visibility": "owner",
      "sensitivity": "internal",
      "cognitive_type": "insight",
      "body": "AI活用支援の相談は月20万から半年500万円規模まで幅があり、営業代行で現金化しながら自社プロダクトの導入機会を作る動線がある。",
      "metadata": {
        "meeting_date": "2026-05-15",
        "repo": "Unson-LLC/salestailor-project",
        "path": "meetings/minutes/2026-05-15_social-gathering-business-networking-talk.md",
        "category": "sales_philosophy"
      }
    }
  ],
  "rejected": [
    {
      "reason": "medical_or_health",
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
- and: 家族・医療情報は `rejected` に入る

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
- AP-3: 家族・医療・私的事情を、数字や思想の補強として使う。
- AP-4: 外部組織の正本情報を議事録だけで作る。
- AP-5: extraction失敗時に黙って0件成功扱いにする。

## Verification

- V-1: sample SalesTailor minutesで `adopted` / `rejected` / `needs_review` が分かれる。
- V-2: privacy guard testで家族・医療情報がcandidate bodyへ入らない。
- V-3: duplicate guard testで同じ `source_event_ids` の再投入が発生しない。
- V-4: dry-run integrationでproduction writeせず候補差分を表示できる。
- V-5: write後のContext integrationで `oyasumi-meeting-personal-kg` が `candidate_sources` に出る。
