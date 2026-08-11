# Requirement Consistency

| 項目 | 内容 |
|------|------|
| Status | pass |
| Invariants | 24 |
| Scenario Gaps | 0 |
| Contradictions | 0 |
| Scanned Code Files | 0 |
| Requirement Sources | 8 |
| Spec Refs | 3 |
| Architecture Refs | 4 |
| Policy Refs | 0 |
| Domain Contract Refs | 1 |
| Responsibility Authority Matches | 0 |
| Responsibility Authority Unknowns | 0 |
| Structured Inherited Behavior Declarations | 0 |
| Legacy Keyword Resolutions | 0 |

## Invariants

- REQ-INV-001: 雲孫のfinance情報は一般org payloadから分離し、ceoかつfinance clearanceでのみ読めるレコードに保持する。 (story:docs/management/stories/story-graph-data-ssot-normalization.md)
- REQ-INV-002: legacy personは物理削除せずmerged状態にし、認可・RACIの現行参照だけcanonical personへ移す。 (story:docs/management/stories/story-graph-data-ssot-normalization.md)
- REQ-INV-003: 監査ログは履歴のIDを保持する。 (story:docs/management/stories/story-graph-data-ssot-normalization.md)
- REQ-INV-004: 雲孫のfinance情報が一般org readから除外され、ceo + finance境界に隔離される。 (story:docs/management/stories/story-graph-data-ssot-normalization.md)
- REQ-INV-005: legacy payload内のfinance情報のアクセス境界 (story:docs/management/stories/story-graph-data-ssot-normalization.md)
- REQ-INV-006: legacy personを参照するauth_grants 1件、raci_assignments 8件 (story:docs/management/stories/story-graph-data-ssot-normalization.md)
- REQ-INV-007: Operation Handbook v3の正式採用、旧制度凍結、制度分離に関するdecision登録 (story:docs/management/stories/story-graph-data-ssot-normalization.md)
- REQ-INV-008: 今回確認した佐藤圭吾以外のperson重複の一括整理 (story:docs/management/stories/story-graph-data-ssot-normalization.md)
- REQ-INV-009: commit後の巻き戻しは、同じ対象IDだけをバックアップ値へupsert/updateする専用rollback処理で行う。 (story:docs/management/stories/story-graph-data-ssot-normalization.md)
- REQ-INV-010: 監査ログの過去person IDは履歴として保持し、現在参照と履歴参照を区別する。 (story:docs/management/stories/story-graph-data-ssot-normalization.md)
- REQ-INV-011: targeted backup・transaction・rollback対応の正規化スクリプトを用意する。 (story:docs/management/stories/story-graph-data-ssot-normalization.md)
- REQ-SRC-001: 既存 brainbase インフラ（brainbase-nocodb, paperclip-prod Lightsail インスタンス）と同じ AWS アカウント (k.sato profile, ap-northeast-1) で運用する。 (spec:docs/specs/mesh-agent-query-spec.md)
- REQ-SRC-002: **新規 Lightsail インスタンス**: brainbase-relay **理由**: - 既存 brainbase インフラ運用パターン（Lightsail）と統一 → 学習コストゼロ - 月額約$5でMVPには十分（3-7人チーム想定） - 独立インスタンスで障害分離（brainbase-nocodbと連鎖しない） - Lightsail snapshot で簡単バックアップ - Phase 4+ でトラフィック増加時は ECS/EKS への移行容易 (spec:docs/specs/mesh-agent-query-spec.md)
- REQ-SRC-003: ピア情報（nodeId, publicKey, roleRank, projects）はメモリ保持のみ。 (spec:docs/specs/mesh-agent-query-spec.md)
- REQ-SRC-004: 再起動後も拒否し続ける（§12 セキュリティ境界） (spec:docs/specs/mesh-agent-query-spec.md)
- REQ-SRC-005: サイズ超過時 MESH_ENVELOPE_TOO_LARGE を返却（接続は維持） (spec:docs/specs/mesh-agent-query-spec.md)
- REQ-SRC-006: リプレイ検出時 MESH_ENVELOPE_EXPIRED を返却（接続は維持、但し連続発生時は切断） (spec:docs/specs/mesh-agent-query-spec.md)
- REQ-SRC-007: INV-2: Graph SSOT records are never mixed into candidate-store collections. (spec:docs/specs/story-brainbase-admin-visualization-bdd-spec.md)
- REQ-SRC-008: INV-3: candidate-store records are never presented as promoted Graph truth unless promotion_status and promoted_graph_entity_id show that relationship explicitly. (spec:docs/specs/story-brainbase-admin-visualization-bdd-spec.md)
- REQ-SRC-009: INV-5: Personal KG is displayed as a read model over owner-visible candidate-store records, never as a separate replacement for Graph SSOT. (spec:docs/specs/story-brainbase-admin-visualization-bdd-spec.md)
- REQ-SRC-010: INV-8: Health/config responses never include secret values, tokens, connection strings, private keys, or raw credential JSON. (spec:docs/specs/story-brainbase-admin-visualization-bdd-spec.md)
- REQ-SRC-011: INV-12: Personal KG owner filters must not silently fall back to the logged-in owner when the requested owner is outside the caller access scope. (spec:docs/specs/story-brainbase-admin-visualization-bdd-spec.md)
- REQ-SRC-012: INV-13: The browser never receives a DB connection string; Personal KG and DB health are read through Brainbase server endpoints. (spec:docs/specs/story-brainbase-admin-visualization-bdd-spec.md)
- REQ-SRC-013: INV-1: The primary new-session path must not activate #create-session-modal. (spec:docs/specs/story-inline-session-creation-spec.md)

## Scenario Gaps

- なし

## Potential Contradictions

- なし

## Structured Inherited Behavior Declarations

- なし

## Legacy Keyword Resolution Deprecations

- なし

## Requirement Sources

- spec: docs/specs/mesh-agent-query-spec.md: Spec: Mesh Agent Query
- spec: docs/specs/story-brainbase-admin-visualization-bdd-spec.md: story-brainbase-admin-visualization-bdd Spec
- spec: docs/specs/story-inline-session-creation-spec.md: Spec: Inline session creation implementation
- architecture: docs/architecture/ADR-017-agent-first-product-surface.md: ADR-017: Agent-first product surface and Web UI retirement
- architecture: docs/architecture/brainbase-surface-responsibility-matrix.md: Brainbase Surface Responsibility Matrix
- architecture: docs/architecture/decision-events-kpi-architecture.md: 判断委任KPI フェーズ1 サーバー側 Architecture
- architecture: docs/architecture/terminal-runtime-architecture.md: Terminal Runtime Architecture
- domain_contract: docs/contracts/meeting-source-integration-catalog.md: Meeting Source Integration Catalog Contract

## Responsibility Authority

- status: not_generated
- matched responsibilities: 0
- matched contract clauses: 0
- missing evidence: 0
- stale evidence: 0
- unregistered candidates: 0
