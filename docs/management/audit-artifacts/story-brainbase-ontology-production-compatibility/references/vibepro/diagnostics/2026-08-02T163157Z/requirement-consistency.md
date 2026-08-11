# Requirement Consistency

| 項目 | 内容 |
|------|------|
| Status | pass |
| Invariants | 21 |
| Scenario Gaps | 0 |
| Contradictions | 0 |
| Scanned Code Files | 0 |
| Requirement Sources | 5 |
| Spec Refs | 3 |
| Architecture Refs | 2 |
| Policy Refs | 0 |
| Domain Contract Refs | 0 |
| Responsibility Authority Matches | 0 |
| Responsibility Authority Unknowns | 0 |
| Structured Inherited Behavior Declarations | 0 |
| Legacy Keyword Resolutions | 0 |

## Invariants

- REQ-INV-001: production shadow audit: 6,156件から61件へ削減（99.009%） (story:docs/management/stories/active/story-brainbase-ontology-production-compatibility.md)
- REQ-INV-002: 残存: 孤立edge 31件、app owner 26件、Decision decider 3件、Decision scope 1件 (story:docs/management/stories/active/story-brainbase-ontology-production-compatibility.md)
- REQ-INV-003: activation: No-Goを維持 (story:docs/management/stories/active/story-brainbase-ontology-production-compatibility.md)
- REQ-INV-004: publication Decision/RACIや署名鍵の作成 (story:docs/management/stories/active/story-brainbase-ontology-production-compatibility.md)
- REQ-SRC-001: 型の意味、identity境界、利用条件、例・反例、owner (architecture:docs/architecture/ADR-021-brainbase-ontology-kernel.md)
- REQ-SRC-002: activeなcurrentが存在するとき、既存の分離された汎用Graph entity/edge APIは登録型・relation・endpointだけを保存前検証し、必須relation制約はatomic commitまたはauditで評価する。 (architecture:docs/architecture/ADR-021-brainbase-ontology-kernel.md)
- REQ-SRC-003: current不在時は既存clientを停止させず従来挙動を維持するが、Graphへ書くすべての既存runtime pathの成功responseへ後方互換なguard_status: inactive_no_currentを必須追加し、内部監査だけで代替しない。 (architecture:docs/architecture/ADR-021-brainbase-ontology-kernel.md)
- REQ-SRC-004: 既存の専用write pathは互換性維持のため直ちに全面遮断せず、既存relationをmanifestへ登録し、後続で同じguardへ収束させる。 (architecture:docs/architecture/ADR-021-brainbase-ontology-kernel.md)
- REQ-SRC-005: MCPの既存Core/Extension表示契約は維持し、manifestとの不一致をcontract testで検出する。 (architecture:docs/architecture/ADR-021-brainbase-ontology-kernel.md)
- REQ-SRC-006: **INV-2**: ProviderRegistry は service code で provider を解決（重複登録は最後勝ち、warning）。 (spec:docs/specs/settings-plugin-contract-v2-spec.md)
- REQ-SRC-007: **INV-4**: OAuth state は actor / scope / org / project / return URL / nonce を含み、署名 + one-time（Codex 警告 #4）。 (spec:docs/specs/settings-plugin-contract-v2-spec.md)
- REQ-SRC-008: **S-2**: 重複 register → 後勝ち + warning ログ (spec:docs/specs/settings-plugin-contract-v2-spec.md)
- REQ-SRC-009: INV-2: OAuth state は SPEC-settings-plugin-contract-v2 の signOAuthState を経由（actor + return URL + nonce 署名）。 (spec:docs/specs/sns-account-management-spec.md)
- REQ-SRC-010: INV-7: SNS Growth Cockpit は X アカウント未接続・connected・health ok/ng・posting default・metrics default を同じ運用面に表示する。 (spec:docs/specs/sns-account-management-spec.md)
- REQ-SRC-011: S-6: Health Check を押すと provider health/rate limit が同じ画面に戻る (spec:docs/specs/sns-account-management-spec.md)
- REQ-SRC-012: canonical_tasks を Brainbase PostgreSQL に追加し、Task本文・版・冪等キー・source refsを保持する。 (architecture:docs/architecture/story-canonical-task-postgres-ssot.md)
- REQ-SRC-013: opaque ID は既存 ct1 を維持する。 (architecture:docs/architecture/story-canonical-task-postgres-ssot.md)
- REQ-SRC-014: 新規IDには store discriminator postgres と UUID を署名して埋め込む。 (architecture:docs/architecture/story-canonical-task-postgres-ssot.md)
- REQ-SRC-015: 既存NocoDB opaque IDは移行期間中に読み取れるよう、migrationで同じ公開IDへ対応する legacy_nocodb_id を保持する。 (architecture:docs/architecture/story-canonical-task-postgres-ssot.md)
- REQ-SRC-016: migrationは NocoDB read -> PostgreSQL upsert の一方向だけとし、dry-run/check/applyを分離する。 (architecture:docs/architecture/story-canonical-task-postgres-ssot.md)
- REQ-SRC-017: 再実行時はIDだけでなくpayload fingerprint・version・operation markerの完全一致を要求し、 (architecture:docs/architecture/story-canonical-task-postgres-ssot.md)

## Scenario Gaps

- なし

## Potential Contradictions

- なし

## Structured Inherited Behavior Declarations

- なし

## Legacy Keyword Resolution Deprecations

- なし

## Requirement Sources

- spec: docs/specs/brainbase-ontology-production-compatibility.md: Brainbase Ontology Production Compatibility Spec
- architecture: docs/architecture/ADR-021-brainbase-ontology-kernel.md: ADR-021: Ontology Kernelの正本・検証境界・推論・version契約
- spec: docs/specs/settings-plugin-contract-v2-spec.md: SPEC: Settings Provider Plugin Contract v2
- spec: docs/specs/sns-account-management-spec.md: SPEC: X Provider Adapter
- architecture: docs/architecture/story-canonical-task-postgres-ssot.md: Architecture: Canonical Task PostgreSQL SSOT

## Responsibility Authority

- status: not_generated
- matched responsibilities: 0
- matched contract clauses: 0
- missing evidence: 0
- stale evidence: 0
- unregistered candidates: 0
