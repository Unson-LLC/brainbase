---
spec_id: SPEC-candidate-store-mvp
title: Memory Candidate Store + Promotion Gate MVP Specification
status: draft
date: 2026-05-11
story_id: str.brainbase.candidate-store-mvp
related_adrs:
  - ADR-006
  - ADR-007
  - ADR-008
  - ADR-009
related_specs:
  - SPEC-acl-contract-test
implementation_files:
  - server/sql/candidate-store-schema.sql
  - server/services/candidate-store/candidate-repository.js
  - server/services/candidate-store/promotion-gate-service.js
  - server/services/candidate-store/raw-ledger-adapter.js
  - server/services/candidate-store/dreaming-job.js
  - server/services/candidate-store/pii-scanner.js
  - server/routes/candidate-store.js
  - server/controllers/candidate-store-controller.js
test_files:
  - tests/candidate-store/**/*.test.js
---

# SPEC: Memory Candidate Store + Promotion Gate MVP

## 目的

STR-006 Memory Promotion Pipeline の First Slice を実装する。Brainbase session/terminal activity を Raw Ledger 経由で candidate に変換し、Promotion Gate を経て **承認されたものだけ** Graph SSOT へ promote する。

ADR-007 で定義した cognitive types（observation/insight/claim/preference/hypothesis/experiment/result）は **すべて candidate-store に住む**。Graph SSOT 直接書き込み禁止。

## Invariants

- **INV-1**: candidate-store のレコードは Graph SSOT retrieval から見えない（SPEC-acl-contract-test INV-9 と整合）。
- **INV-2**: candidate の `promotion_status` 遷移は単調： `candidate → pending_approval → approved|rejected|expired → promoted_to_graph`。逆行不可。
- **INV-3**: `promoted_to_graph` 状態になった candidate に対応する Graph entity は **derived_from edge** で元 candidate を指す（ADR-007 promotion パターン a）。
- **INV-4**: PII / secret スキャナで block 判定された raw activity は candidate 生成されない（block log にのみ残る）。
- **INV-5**: candidate の owner_person_id / org_ids / project_ids / visibility / sensitivity / role_min / agency_level は **必須**。欠落時は candidate 作成失敗。
- **INV-6**: Dreaming job は candidate を生成するのみ、Graph SSOT に直接書かない。
- **INV-7**: promote 時、対象 catalog type が存在しない場合（既存 14 type にマップ不能）は `rejected` で reason="no catalog mapping" になる（new-type-judgment-gate で個別検討）。
- **INV-8**: audit_events table に全 state transition が記録される（actor, decision_owner, reason, decided_at, evidence_ids, previous_status, next_status）。
- **INV-9**: candidate の `redaction_status` が `needs_redaction` の間は promote 不可。
- **INV-10**: same `source_event_id` から重複 candidate 生成を防ぐ unique constraint。

## Contracts

### Contract-1: Raw Ledger envelope

STR-006 で定義済み。再掲：

```json
{
  "raw_event_id": "raw_<source>_<uuid>",
  "source_system": "brainbase|mana_slack|mana_workflow|meeting|github|nocodb|manual",
  "source_event_id": "session:...|slack:...|workflow:...",
  "occurred_at": "ISO-8601",
  "captured_at": "ISO-8601",
  "actor_external_id": "U...",
  "actor_person_id": "per_xxx",
  "workspace": "unson",
  "channel_id": "C...|null",
  "project_code": "brainbase|null",
  "permission_snapshot": {
    "roles": ["gm"],
    "channel_membership": true,
    "project_membership": true,
    "clearance": ["internal", "restricted"]
  },
  "evidence_ref": {
    "kind": "source_pointer",
    "uri": "brainbase:session:...",
    "hash": "sha256:..."
  },
  "retention_policy": "source_retained|envelope_only|redacted"
}
```

### Contract-2: Memory Candidate record (DB)

```sql
CREATE TABLE memory_candidates (
  id TEXT PRIMARY KEY,                 -- cand_<uuid>
  cognitive_type TEXT NOT NULL,        -- observation|insight|claim|preference|hypothesis|experiment|result
  owner_person_id TEXT NOT NULL,
  actor_person_id TEXT NOT NULL,
  source_system TEXT NOT NULL,
  source_event_ids JSONB NOT NULL,
  workspace TEXT,
  channel_id TEXT,
  thread_ts TEXT,
  project_code TEXT,
  org_ids TEXT[] NOT NULL DEFAULT '{}',
  team_id TEXT,
  visibility TEXT NOT NULL,            -- owner|team|org|public
  sensitivity TEXT NOT NULL,
  role_min TEXT NOT NULL DEFAULT 'member',
  agency_level TEXT NOT NULL DEFAULT 'synthesize',
  recommended_subject_type TEXT,       -- catalog type for promote target
  recommended_owner_person_id TEXT,    -- approver candidate
  promotion_status TEXT NOT NULL,      -- candidate|pending_approval|approved|rejected|expired|promoted_to_graph
  promoted_graph_entity_id TEXT,       -- set after promote
  requires_approval BOOLEAN NOT NULL DEFAULT TRUE,
  permission_snapshot JSONB,
  evidence_ids JSONB NOT NULL,
  body TEXT NOT NULL,                  -- candidate content (markdown)
  redaction_status TEXT NOT NULL DEFAULT 'none', -- none|redacted|needs_redaction
  confidence NUMERIC,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source_system, owner_person_id, source_event_ids)
);

CREATE TABLE promotion_audit_events (
  id BIGSERIAL PRIMARY KEY,
  candidate_id TEXT NOT NULL REFERENCES memory_candidates(id),
  actor_person_id TEXT NOT NULL,
  decision_owner_person_id TEXT,
  decision_reason TEXT,
  decided_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  previous_status TEXT NOT NULL,
  next_status TEXT NOT NULL,
  evidence_ids JSONB
);
```

candidate-store は **独立 RLS policy**。Graph SSOT の retrieval から見えない（INV-1 / SPEC-acl-contract-test INV-9）。

### Contract-3: Promotion Gate API

```ts
// POST /api/candidates
createCandidate(input: CandidateInput): Candidate

// GET /api/candidates?owner=&status=&type=
listCandidates(filter): Candidate[]

// POST /api/candidates/:id/approve
approveCandidate(id, approver: JWT, reason): {candidate, graphEntity}

// POST /api/candidates/:id/reject
rejectCandidate(id, approver: JWT, reason): Candidate

// POST /api/candidates/:id/redact
redactCandidate(id, approver: JWT, redactedBody): Candidate

// POST /api/candidates/auto-promote
autoPromote(id, system): {candidate, graphEntity}  // private preference 等の低リスク用
```

### Contract-4: Brainbase Activity Adapter

```ts
brainbaseSessionToRawLedger(session: Session, terminal: TerminalLog): RawLedgerRecord[]
```

- session 終了時に呼び出される（または明示 capture 要求時）
- terminal output から secret/PII を scan して block
- evidence_ref で session 内部にポインタを保持（生 transcript は graph に流さない）

### Contract-5: Dreaming Job

```ts
async function dreamingPass(rawLedgerRecords: RawLedgerRecord[], scope: 'personal'|'project'|'org'): Promise<CandidateDraft[]>
```

- candidate 候補を生成のみ、DB write は別 step
- LLM 利用可、ただし出力は人間 approve 前提
- `cognitive_type` を推定（observation default、明らかな insight pattern なら昇格）
- `recommended_subject_type` を提案（catalog mapping）

### Contract-6: PII / Secret Scanner

```ts
scan(content: string): { block: boolean, findings: ScanFinding[] }
```

- block 判定基準（最小）: API key pattern / password / private key / Infisical reference / email + phone 同時出現
- review 判定: 個人名 + 機微 keyword の組み合わせ
- block → candidate 作成しない、scan log に残す
- review → candidate 作成、`redaction_status=needs_redaction` flag

### Contract-7: Promote to Graph

```ts
promoteCandidateToGraph(candidate: Candidate, approver: JWT, targetCatalogType: string): GraphEntity
```

- INV-3: 新 instance を作成、`derived_from` edge で元 candidate を指す
- 元 candidate を `promoted_to_graph` に遷移、`promoted_graph_entity_id` を埋める
- audit_events に transition 記録

## Scenarios

### S-1: brainbase session → observation candidate

- **given**: ユーザー sato が brainbase session で `terminal output: "Z.aiのAPIが期待値より速い"` を出す
- **when**: session 終了時 activity adapter が dreaming pass を実行
- **then**: cognitive_type=observation, owner=sato, visibility=owner, promotion_status=candidate の row が memory_candidates に作成される。元 raw_event_id は evidence_ids に残る。
- **検証**: tests/candidate-store/scenarios/s-1-session-to-observation.test.js

### S-2: observation を pending_approval へ進める

- **given**: candidate (status=candidate, requires_approval=true)
- **when**: POST /api/candidates/:id/request-approval
- **then**: status → pending_approval、audit_event 記録
- **検証**: tests/candidate-store/scenarios/s-2-request-approval.test.js

### S-3: approve → promote_to_graph

- **given**: candidate (status=pending_approval), approver = owner_person_id
- **when**: POST /api/candidates/:id/approve { reason }
- **then**: 新 graph entity 作成 + derived_from edge / candidate.status=promoted_to_graph / audit 記録
- **検証**: tests/candidate-store/scenarios/s-3-approve-promote.test.js

### S-4: reject → 終端

- **given**: candidate (status=pending_approval)
- **when**: POST /api/candidates/:id/reject { reason }
- **then**: status=rejected, 不可逆、graph entity 作成されない
- **検証**: tests/candidate-store/scenarios/s-4-reject.test.js

### S-5: catalog 不一致 → rejected

- **given**: candidate with cognitive_type=hypothesis, recommended_subject_type=none
- **when**: approve 試行
- **then**: rejected, reason="no catalog mapping"（INV-7 / new-type-judgment-gate へ送られる）
- **検証**: tests/candidate-store/scenarios/s-5-no-catalog-mapping.test.js

### S-6: PII 検出で candidate ブロック

- **given**: terminal output に `OPENAI_API_KEY=sk-xxx` 含む
- **when**: dreaming pass
- **then**: candidate 作成されず、scan log に block 記録
- **検証**: tests/candidate-store/scenarios/s-6-secret-block.test.js

### S-7: ACL 適用：他 actor は candidate を見られない

- **given**: candidate (owner=sato, visibility=owner)
- **when**: actor=umeda が listCandidates 実行
- **then**: 上記 candidate は含まれない（candidate-store の RLS）
- **検証**: tests/candidate-store/scenarios/s-7-acl-owner.test.js

### S-8: expires_at 経過で auto expire

- **given**: candidate with expires_at < now()
- **when**: expire job 実行
- **then**: status=expired, audit 記録
- **検証**: tests/candidate-store/scenarios/s-8-expire.test.js

## Anti-patterns

- **AP-1**: dreaming job が直接 Graph SSOT へ write する
  - **理由**: 未承認データが組織知識化される。INV-6 違反
  - **検証**: tests/candidate-store/anti/ap-1-dreaming-direct-graph-write.test.js

- **AP-2**: candidate を Graph retrieval で leak
  - **理由**: SPEC-acl-contract-test INV-9 違反、未承認データ流出
  - **検証**: tests/candidate-store/anti/ap-2-candidate-leak-via-graph.test.js

- **AP-3**: same source_event_id から重複 candidate 生成
  - **理由**: 同じ観察が何度も approval queue に流れる
  - **検証**: tests/candidate-store/anti/ap-3-duplicate-source-event.test.js

- **AP-4**: PII scanner を bypass する API
  - **理由**: secret 漏洩経路
  - **検証**: tests/candidate-store/anti/ap-4-pii-bypass.test.js

- **AP-5**: `promotion_status` を逆行させる API
  - **理由**: audit 整合性破壊
  - **検証**: tests/candidate-store/anti/ap-5-status-rollback.test.js

## Verification

| Clause | Test path | Status |
|---|---|---|
| INV-1 | tests/candidate-store/invariants/inv-1-graph-isolation.test.js | ✅ |
| INV-2 | tests/candidate-store/invariants/inv-2-status-monotonic.test.js | ✅ |
| INV-3 | tests/candidate-store/invariants/inv-3-derived-from-edge.test.js | ✅ |
| INV-4 | tests/candidate-store/invariants/inv-4-pii-block.test.js | ✅ |
| INV-5 | tests/candidate-store/invariants/inv-5-acl-fields-required.test.js | ✅ |
| INV-6 | tests/candidate-store/invariants/inv-6-dreaming-no-direct-write.test.js | ✅ |
| INV-7 | tests/candidate-store/invariants/inv-7-catalog-mapping-required.test.js | ✅ |
| INV-8 | tests/candidate-store/invariants/inv-8-audit-log.test.js | ✅ |
| INV-9 | tests/candidate-store/invariants/inv-9-redaction-block.test.js | ✅ |
| INV-10 | tests/candidate-store/invariants/inv-10-unique-source-event.test.js | ✅ |
| S-1〜S-8 | tests/candidate-store/scenarios/*.test.js | ✅ |
| AP-1〜AP-5 | tests/candidate-store/anti/*.test.js | ✅ |

合計 **23 test files**（INV 10 + S 8 + AP 5）。

## 受け入れ基準

- [ ] DB schema: memory_candidates / promotion_audit_events / RLS policy
- [ ] AccountController に類する CandidateStoreController + routes
- [ ] Brainbase Activity Adapter（session 終了 hook）
- [ ] Dreaming job（async、まず手動 trigger でOK）
- [ ] PII/secret scanner（既存 ScanFinding pattern 拡張）
- [ ] Promote writer（Graph SSOT への derived_from edge 込み write）
- [ ] 23 test files 全部実装、pass
- [ ] Spec Verification table ✅ 化

## 非選択肢

- raw transcript を Graph SSOT へ写す
- candidate-store を Graph SSOT と同テーブル化（visibility のみで分離）
- approval なしで全 candidate 自動 promote（private preference 限定例外は SPEC-private-preference-promotion で定義）
- LLM 出力を直 promote（必ず human approver 経由、低リスク auto-promote ですら policy 経由）
- 既存 RLS policy を破壊

## 関連

- STR-006: docs/architecture/mana-secretary-memory-promotion-architecture.md
- ADR-006/007/008/009
- SPEC-acl-contract-test
