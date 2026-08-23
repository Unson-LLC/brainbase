---
story_id: story-graph-maintenance-phase0
title: Graph SSOTデータ整備 Phase 0 MCP
status: active
created_at: 2026-08-20
updated_at: 2026-08-21
horizon: now
view: platform
architecture_reason: "既存Graphを重複追加で代用せず、tenant境界、事前計画、楽観ロック、監査Receipt、Rollbackを持つ専用保守経路から安全に整備するため。"
spec_docs:
  - path: .vibepro/spec/story-graph-maintenance-phase0/spec.json
    status: final
---

# Graph SSOTデータ整備 Phase 0 MCP

## User Story

Brainbaseの運用担当として、既存Graph EntityとEdgeを直接かつ安全に整備したい。そうすれば、Candidate追加で重複を増やさず、変更前後、理由、実行者、検証結果、Rollback情報を同じPlanとReceiptから追跡できる。

## Delivery Boundary

Phase 0はGraph保守用のMCP、REST、transaction service、schema、検証を追加する。本番Graphの実データ整備、本番schema適用、Phase 1以降のBaseline監査はこの変更では実行しない。

## Acceptance Criteria

- [x] AC-001: MCP tools exactly: graph_export_snapshot, graph_record_human_gate_receipt, graph_plan_mutations, graph_apply_plan, graph_get_plan_receipt, graph_rollback_plan, graph_validate。
- [x] AC-002: Graph maintenance REST/MCP contractはsnapshot、Human Gate receipt、plan、apply、receipt、rollback、validateを提供する。
- [x] AC-003: signed tenant authorizationとproject scopeを要求する。
- [x] AC-004: expected_version、idempotency key、bulk limit、dry-run/apply snapshot hash equality、reason required。
- [x] AC-005: Allowed mutation ops: patch_entity, merge_entities, retire_entity, move_scope, upsert_edge, retire_edge, normalize_alias。
- [x] AC-006: no sensitivity lowering; Active Decision retire requires Human Gate receipt。
- [x] AC-007: rollback receiptを発行し、original stateへ戻る。
- [x] AC-008: Phase 0 schema migrationとPostgreSQL roundtripを確認する。
- [x] AC-009: Snapshot → Dry Run → Patch → 再取得 → Validation → Rollback → original state。

## Scenarios

- `GM-S-001`: 認証済みproject scopeで7つのMCP toolが対応するREST endpointを呼び、scope外projectはHTTP到達前に拒否される。
- `GM-S-002`: 同じidempotency keyと入力を再実行しても変更を増やさず、異なる入力はconflictとして拒否する。
- `GM-S-003`: 他tenantまたは他projectに存在するedge IDを指定しても、上書きやscope移動を行わず拒否する。
- `GM-S-004`: mergeまたはpatchでsensitivityやrole_minを下げず、active Decisionのretireは束縛済みHuman Gate Receiptなしでは拒否する。
- `GM-S-005`: PostgreSQLの隔離schemaでSnapshot、Plan、Apply、再取得、Ontology Validation、Receipt、Rollbackを通し、追加edgeを削除して元のrow集合とhashへ戻る。
- `GM-S-006`: 旧schemaへmigrationを複数回適用しても成功し、組織所有権が一意なprojectだけを安全にbackfillする。

## Evidence and Completion

- MCP全テスト、serverの契約・安全性テスト、型検査を同じGit HEADで通す。
- 実PostgreSQL試験は隔離schemaだけを作成・破棄し、本番Graph rowを変更しない。
- VibeProのSpec drift、traceability、Gate、PR作成を同じHEADへ束縛する。

## Out of Scope

- 本番Graphデータの変更
- 本番PostgreSQLへのmigration適用
- Phase 1以降のBaseline、Canonical Model、Pilot Migration
