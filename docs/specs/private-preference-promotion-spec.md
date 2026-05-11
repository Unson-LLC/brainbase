---
spec_id: SPEC-private-preference-promotion
title: Private Preference Auto-Promotion Specification
status: draft
date: 2026-05-11
story_id: str.brainbase.private-preference-promotion
related_adrs:
  - ADR-006
  - ADR-008
related_specs:
  - SPEC-candidate-store-mvp
  - SPEC-acl-contract-test
implementation_files:
  - server/services/candidate-store/auto-promote-policy.js
  - server/services/candidate-store/auto-promote-policy/private-preference.js
test_files:
  - tests/candidate-store/auto-promote/*.test.js
---

# SPEC: Private Preference Auto-Promotion

## 目的

candidate-store-mvp が動いた後、**最も低リスクな cognitive type = preference** を **人間 approve なしに owner-private scope へ自動 promote** する pipeline を実装する。これは STR-006 First Slice 6（"low-risk private preference を本人 scope へ自動昇格"）の実体化。

## Invariants

- **INV-1**: auto-promote 対象は `cognitive_type = preference` かつ `visibility = owner` かつ `sensitivity ∈ {internal}` かつ `agency_level ∈ {synthesize, read-only}` のみ。
- **INV-2**: owner_person_id = actor_person_id（自分の preference のみ）が必須。他者 preference は auto-promote しない。
- **INV-3**: PII scanner 結果が `clean`（block/review 共に無し）のみ auto-promote。
- **INV-4**: auto-promote の Graph entity は `subject_type = person`（owner 自身を指す）に preference を attach する形（STR-006 設計の "person-scoped memory"）。
- **INV-5**: auto-promote 後も audit_events に entry 必須（actor=system / decision_owner=owner / reason="auto-promote private preference"）。
- **INV-6**: owner はいつでも auto-promoted preference を redact / archive できる（reuptake、ADR-006 シナプス概念）。
- **INV-7**: 1日あたり auto-promote 数に上限（rate limit、default 50/day per user）。超過は pending_approval に回す。

## Contracts

### Contract-1: AutoPromotePolicy interface

```ts
interface AutoPromotePolicy {
  name: string;                                  // "private-preference"
  applies(candidate: Candidate): boolean;        // INV-1 / INV-2 / INV-3 / INV-7 check
  targetSubjectType(): string;                   // "person"
  buildGraphPayload(candidate: Candidate): Partial<GraphEntity>;
}
```

### Contract-2: PrivatePreferencePolicy

```ts
applies(c):
  c.cognitive_type === 'preference'
  && c.visibility === 'owner'
  && c.sensitivity === 'internal'
  && ['synthesize', 'read-only'].includes(c.agency_level)
  && c.owner_person_id === c.actor_person_id
  && c.redaction_status === 'none'
  && dailyCount(c.owner_person_id) < 50
```

### Contract-3: Auto-promote flow

```
candidate 作成
  → AutoPromotePolicy.applies() = true
  → 自動的に approveCandidate(id, system_jwt, reason)
  → promoteCandidateToGraph()
  → Graph entity (type=person, attached preference field)
```

human approval queue には載らない（rate limit 超過時のみ pending_approval へ）。

## Scenarios

### S-1: 自分の coding preference を auto-promote

- **given**: candidate { cognitive_type=preference, owner=sato, actor=sato, visibility=owner, sensitivity=internal, body="圧縮品質は0.7派" }
- **when**: createCandidate → policy 評価
- **then**: policy.applies=true → 自動 approve → promote → person(sato) entity に preference field 追加
- **検証**: tests/candidate-store/auto-promote/s-1-coding-preference.test.js

### S-2: 他人の preference は auto-promote しない

- **given**: candidate { owner=umeda, actor=sato（observer）}
- **when**: policy 評価
- **then**: applies=false（owner != actor）、pending_approval に回る
- **検証**: tests/candidate-store/auto-promote/s-2-other-owner-block.test.js

### S-3: PII含有 → auto-promote拒否

- **given**: candidate { ..., body="俺の好み（電話番号: 090-xxx-xxxx）" }, redaction_status=needs_redaction
- **when**: policy 評価
- **then**: applies=false（INV-3）、pending_approval に回る
- **検証**: tests/candidate-store/auto-promote/s-3-pii-redaction-block.test.js

### S-4: rate limit 超過

- **given**: 当日すでに 50 件 auto-promote 済
- **when**: 51 件目の candidate 評価
- **then**: applies=false（INV-7）、pending_approval に回る
- **検証**: tests/candidate-store/auto-promote/s-4-rate-limit.test.js

### S-5: owner redact 後

- **given**: auto-promoted preference, owner が redact API 呼び出し
- **when**: GET person(owner) → preferences
- **then**: 該当 preference が消えている、audit 記録
- **検証**: tests/candidate-store/auto-promote/s-5-owner-redact.test.js

## Anti-patterns

- **AP-1**: agency_level=none の preference を auto-promote
  - **理由**: 「AI に使わせない」と書いた preference を Graph に流すと矛盾
  - **検証**: tests/candidate-store/auto-promote/ap-1-agency-none-block.test.js

- **AP-2**: visibility=team or org の "preference" を auto-promote
  - **理由**: 共有判断は人間がすべき、auto-promote の信頼境界を超える
  - **検証**: tests/candidate-store/auto-promote/ap-2-non-owner-visibility-block.test.js

- **AP-3**: cognitive_type ≠ preference を auto-promote
  - **理由**: claim / hypothesis は subjective 度合いが違う、approval 必要
  - **検証**: tests/candidate-store/auto-promote/ap-3-non-preference-block.test.js

## Verification

| Clause | Test path | Status |
|---|---|---|
| INV-1〜7 | tests/candidate-store/auto-promote/invariants/*.test.js | ✅ |
| S-1〜5 | tests/candidate-store/auto-promote/s-*.test.js | ✅ |
| AP-1〜3 | tests/candidate-store/auto-promote/ap-*.test.js | ✅ |

合計 **15 test files**（INV 7 + S 5 + AP 3）。

## 受け入れ基準

- [ ] AutoPromotePolicy interface 定義
- [ ] PrivatePreferencePolicy 実装
- [ ] candidate 作成時 policy 評価 hook
- [ ] daily rate limit counter
- [ ] redact API（reuptake 動線）
- [ ] 15 test files 全部 pass
- [ ] Spec Verification table ✅

## 非選択肢

- 他 cognitive_type を auto-promote（MVP は preference のみ）
- team/org scope auto-promote（必ず人間 approve）
- LLM 推論で applies 判定（明示 rule 評価のみ）

## 関連

- SPEC-candidate-store-mvp（上流）
- STR-006 First Slice 6
- ADR-006 シナプス reuptake 概念
