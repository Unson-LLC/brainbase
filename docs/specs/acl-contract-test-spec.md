---
spec_id: SPEC-acl-contract-test
title: ACL Contract Test Specification
status: draft
date: 2026-05-11
story_id: str.brainbase.acl-contract-test
related_adrs:
  - ADR-006
  - ADR-007
  - ADR-008
  - ADR-009
related_specs: []
implementation_files:
  - tests/access-contracts/fixtures/access-contexts.fixture.json
  - tests/access-contracts/fixtures/entity.fixture.json
  - tests/access-contracts/helpers/jwt-helper.js
  - tests/access-contracts/helpers/rls-runner.js
test_files:
  - tests/access-contracts/invariants/*.test.js
  - tests/access-contracts/scenarios/*.test.js
  - tests/access-contracts/anti/*.test.js
---

# SPEC: ACL Contract Test

## 目的

ADR-008 で定義した 8 軸の ACL（owner_person_id / org_ids / project_ids / team_id / visibility / sensitivity / role_min / agency_level）が、実装前段階で**契約として独立に動く**ことを fixture + test で証明する。実装（candidate-store / Graph SSOT 拡張 / RLS policy）の前に gate として機能する。

## Invariants

- **INV-1**: `visibility=owner` の entity は `owner_person_id` が一致する actor のみ retrieval で deny されない。他の actor には deny される。
- **INV-2**: `visibility=team` の entity は actor の所属 team_id 集合に entity.team_id が含まれる場合のみ deny されない。
- **INV-3**: `visibility=org` の entity は actor の `projectCodes` から推定される org 集合と entity の `org_ids` の積集合が空でない場合のみ deny されない。
- **INV-4**: `visibility=public` の entity は全 actor から retrieval 可能（ただし sensitivity と role_min は引き続き適用）。
- **INV-5**: entity の `sensitivity` が actor の `clearance` 最大値を超える場合、deny される。
- **INV-6**: entity の `role_min` が actor の `role rank` を超える場合、deny される。
- **INV-7**: `org_ids` が空（unknown / migration 残骸）の entity は、`visibility=public` でない限り **default deny**（Codex 指摘の盲点対応）。
- **INV-8**: `agency_level` は visibility と独立軸。`agency_level=none` の entity は AI synthesis context に含まれない（retrieval 結果から除外）が、人間 actor の直接 read は visibility / sensitivity / role_min に従う。
- **INV-9**: candidate-store のレコードは Graph SSOT retrieval から直接読まれない（promote 経由のみ）。candidate-store は別 ACL 領域。
- **INV-10**: 4 組織並立 cross-org member（佐藤さん）は `projectCodes` に複数 org の project が並ぶので、それらの projectCode が示す org の積集合に基づいて retrieve できる。自動 cross-org fire はしない（INV-3 がそのまま適用される、特別扱いなし）。

## Contracts

### Contract-1: retrieval evaluation function

```ts
function canRetrieve(actor: JWT, entity: Entity): { allow: boolean, reason: string }
```

- **input**: actor JWT, entity record
- **output**: `{ allow: true }` or `{ allow: false, reason: "..." }`
- **preconditions**: actor JWT is valid, entity has full ACL fields
- **postconditions**: result is deterministic given same inputs
- **error cases**:
  - entity に owner / org_ids 等の ACL field 欠落 → throw `ACLFieldMissing`
  - JWT に role / projectCodes 欠落 → throw `JWTMalformed`

### Contract-2: fixture format

```json
{
  "access_contexts": [
    {
      "id": "ctx-sato-4org",
      "label": "佐藤=4org member（CEO、4 orgs）",
      "jwt": {
        "sub": "sato_keigo",
        "role": "ceo",
        "level": 4,
        "clearance": ["internal", "restricted", "confidential", "top-secret"],
        "projectCodes": ["brainbase", "salestailor", "techknight", "baao", ...]
      }
    },
    {
      "id": "ctx-single-org-member",
      "label": "単一 org member（雲孫のみ）",
      "jwt": {
        "sub": "umeda",
        "role": "member",
        "level": 1,
        "clearance": ["internal"],
        "projectCodes": ["brainbase", "unson"]
      }
    },
    ...
  ],
  "entities": [
    {
      "id": "ent-org-customer-st",
      "type": "customer",
      "visibility": "org",
      "org_ids": ["salestailor"],
      "sensitivity": "internal",
      "role_min": "member",
      "agency_level": "synthesize",
      "owner_person_id": null
    },
    ...
  ],
  "expected": [
    { "context": "ctx-sato-4org", "entity": "ent-org-customer-st", "allow": true, "reason": "salestailor org member" },
    { "context": "ctx-single-org-member", "entity": "ent-org-customer-st", "allow": false, "reason": "not in salestailor org" }
  ]
}
```

## Scenarios

### S-1: 4org member の retrieval（CEO 佐藤）

- **given**: actor = sato (projectCodes = 4 org), entities = customer/decision/observation 各 org
- **when**: canRetrieve(sato, each entity) 実行
- **then**: 4 org 全部の team/org visibility が allow、他人の owner visibility は deny
- **検証**: tests/access-contracts/scenarios/s-1-multi-org-ceo.test.js

### S-2: 単一 org member の retrieval

- **given**: actor = umeda (projectCodes = unson 配下のみ), entities = 各 org
- **when**: canRetrieve 実行
- **then**: unson org 配下のみ allow、salestailor/techknight/baao は deny
- **検証**: tests/access-contracts/scenarios/s-2-single-org-member.test.js

### S-3: role 失効ユーザー

- **given**: actor = ex-gm (level=1 に降格), entity = role_min=gm の decision
- **when**: canRetrieve 実行
- **then**: deny（INV-6）
- **検証**: tests/access-contracts/scenarios/s-3-role-expired.test.js

### S-4: project 外ユーザー

- **given**: actor = developer (projectCodes に techknight 含まない), entity = techknight project decision
- **when**: canRetrieve 実行
- **then**: deny（INV-3）
- **検証**: tests/access-contracts/scenarios/s-4-project-outsider.test.js

### S-5: Slack channel 外ユーザー（STR-006 deny matrix）

- **given**: actor が channel_id を含む permission_snapshot を持たない, entity = channel memory
- **when**: canRetrieve 実行
- **then**: deny
- **検証**: tests/access-contracts/scenarios/s-5-channel-outsider.test.js

### S-6: joint project（複数 org_ids）

- **given**: actor = sato (4 orgs), entity = `org_ids: [baao, unson]`（共同案件）
- **when**: canRetrieve 実行
- **then**: allow（sato は両 org member）
- **given2**: actor = unson-only member
- **then2**: allow（unson member なら見える）
- **given3**: actor = salestailor-only member
- **then3**: deny（baao も unson も member でない）
- **検証**: tests/access-contracts/scenarios/s-6-joint-project.test.js

### S-7: sensitivity 上限超過

- **given**: actor の clearance = [internal, restricted], entity = sensitivity=top-secret
- **when**: canRetrieve 実行
- **then**: deny（INV-5）
- **検証**: tests/access-contracts/scenarios/s-7-sensitivity-overflow.test.js

### S-8: agency_level による synthesis exclusion

- **given**: actor = sato, entity = visibility=org sensitivity=internal agency_level=none
- **when**: canRetrieveForSynthesis(sato, entity)（AI context 用）実行
- **then**: deny（synthesis から除外）
- **when2**: canRetrieve(sato, entity)（人間 read 用）
- **then2**: allow
- **検証**: tests/access-contracts/scenarios/s-8-agency-level.test.js

## Anti-patterns

- **AP-1**: org_ids 空 entity を visibility=public 以外で許可する → INV-7 違反
  - **理由**: migration 残骸や新規 entity 作成時の入力漏れで意図せず公開される
  - **検証**: tests/access-contracts/anti/ap-1-unknown-org-deny.test.js

- **AP-2**: visibility と sensitivity を同一視（visibility=team なら sensitivity=internal と想定する）
  - **理由**: 「全員見える契約金額」のような org+top-secret pattern が表現できなくなる
  - **検証**: tests/access-contracts/anti/ap-2-visibility-sensitivity-coupling.test.js

- **AP-3**: candidate-store のレコードを Graph SSOT 経由で読む
  - **理由**: promote 前の未承認データが流出
  - **検証**: tests/access-contracts/anti/ap-3-candidate-leak.test.js

- **AP-4**: UI の `requiredLevel` だけで write 権限判定（Codex 指摘）
  - **理由**: server 側で RACI 検証していないと、UI bypass で write 可能
  - **検証**: tests/access-contracts/anti/ap-4-ui-only-permission.test.js

- **AP-5**: cross-org 自動 fire（同一 actor が複数 org member だからといって、別 org の context を勝手に注入）
  - **理由**: 佐藤さんが SalesTailor session で話してる時に雲孫の context が混入したら混乱
  - **検証**: tests/access-contracts/anti/ap-5-cross-org-auto-fire.test.js

## Verification

| Clause | Test path | Status |
|---|---|---|
| INV-1 | tests/access-contracts/invariants/inv-1-owner.test.js | ✅ |
| INV-2 | tests/access-contracts/invariants/inv-2-team.test.js | ✅ |
| INV-3 | tests/access-contracts/invariants/inv-3-org.test.js | ✅ |
| INV-4 | tests/access-contracts/invariants/inv-4-public.test.js | ✅ |
| INV-5 | tests/access-contracts/invariants/inv-5-sensitivity.test.js | ✅ |
| INV-6 | tests/access-contracts/invariants/inv-6-role-min.test.js | ✅ |
| INV-7 | tests/access-contracts/invariants/inv-7-org-empty-deny.test.js | ✅ |
| INV-8 | tests/access-contracts/invariants/inv-8-agency-level.test.js | ✅ |
| INV-9 | tests/access-contracts/invariants/inv-9-candidate-isolation.test.js | ✅ |
| INV-10 | tests/access-contracts/invariants/inv-10-multi-org-member.test.js | ✅ |
| S-1 | tests/access-contracts/scenarios/s-1-multi-org-ceo.test.js | ✅ |
| S-2 | tests/access-contracts/scenarios/s-2-single-org-member.test.js | ✅ |
| S-3 | tests/access-contracts/scenarios/s-3-role-expired.test.js | ✅ |
| S-4 | tests/access-contracts/scenarios/s-4-project-outsider.test.js | ✅ |
| S-5 | tests/access-contracts/scenarios/s-5-channel-outsider.test.js | ✅ |
| S-6 | tests/access-contracts/scenarios/s-6-joint-project.test.js | ✅ |
| S-7 | tests/access-contracts/scenarios/s-7-sensitivity-overflow.test.js | ✅ |
| S-8 | tests/access-contracts/scenarios/s-8-agency-level.test.js | ✅ |
| AP-1 | tests/access-contracts/anti/ap-1-unknown-org-deny.test.js | ✅ |
| AP-2 | tests/access-contracts/anti/ap-2-visibility-sensitivity-coupling.test.js | ✅ |
| AP-3 | tests/access-contracts/anti/ap-3-candidate-leak.test.js | ✅ |
| AP-4 | tests/access-contracts/anti/ap-4-ui-only-permission.test.js | ✅ |
| AP-5 | tests/access-contracts/anti/ap-5-cross-org-auto-fire.test.js | ✅ |

合計 **23 test files**（INV 10 + S 8 + AP 5）。

## 受け入れ基準（実装完了の判定）

- [x] tests/access-contracts/fixtures/ に access-contexts.fixture.json と entity.fixture.json 作成
- [x] tests/access-contracts/helpers/ に jwt-helper.js / rls-runner.js 作成
- [x] 23 test files 全部実装（INV 10 + S 8 + AP 5）
- [x] canRetrieve / canRetrieveForSynthesis の 2 evaluator 関数を実装（fixture-based、まだ実 DB に当てない）
- [x] CI で実行されるよう vitest config に組み込む
- [x] 全 test が pass する（実装の RLS は次 phase だが、evaluator 関数レベルでは contract が成立）
- [x] Spec の Verification table の Status を全部 ✅ にする

## 非選択肢

- ADR-008 の 8 軸を 1 つでも省く → contract が不完全
- 実 PostgreSQL RLS を今 phase で書く → candidate-store-mvp で書く、ここは fixture + evaluator のみ
- 5 deny-by-default 文脈以外の case を入れない → joint project / agency_level / sensitivity / role 失効 を追加

## 関連

- ADR-006 / 007 / 008（このSpecの理論的基盤）
- ADR-009（Spec-first 運用）
- STR-006 deny-by-default matrix（このSpecの源）
- 既存 fixture: `tests/fixtures/memory-promotion/access-contexts.fixture.json`（参考）
