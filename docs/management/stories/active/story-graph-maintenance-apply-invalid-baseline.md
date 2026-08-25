---
story_id: story-graph-maintenance-apply-invalid-baseline
title: 既存不整合を増やさずGraph保守Applyを完了する
status: active
created_at: 2026-08-21
updated_at: 2026-08-21
horizon: now
view: platform
architecture_reason: "既存orphanを含むGraphでも、新規不整合とtenant越境を拒否したまま安全な保守Planを適用・復元できるようにするため。"
spec_docs:
  - path: .vibepro/spec/story-graph-maintenance-apply-invalid-baseline/spec.json
    status: final
---

# 既存不整合を増やさずGraph保守Applyを完了する

## User Story

Brainbaseの運用担当として、既存Graphに既知のorphanが残っていても、その不整合を増やさない保守PlanをApplyしたい。そうすれば、既存不整合の全修復を待たずに、Human Gateで承認済みの隔離作業を監査可能な経路で進められる。

## Acceptance Criteria

- [x] AC-001: ApplyとRollbackは、immutable baselineに存在する同一identityのvalidation issueだけを許容し、新しいissueを拒否する。
- [x] AC-002: 保存済みbefore/after snapshotのhashを再検証し、改変されたPlanをmutation前に拒否する。
- [x] AC-003: baselineで既知のorphan endpointだけをreadbackで許容し、別orphan、tenant/project越境、予定row欠落は拒否する。
- [x] AC-004: PostgreSQL隔離schemaで既存orphanを維持したApply、after hash読戻し、Validate、Rollback、base hashとrow完全復元を確認する。
- [x] AC-005: baselineを指定しない既存のstrict validation契約は変えない。

## Scenarios

- `GM-IB-S-001`: 既存orphanを含むbaselineへ無関係な安全なpatchをApplyし、orphan identityを増減・差替えせずafter hashへ到達する。
- `GM-IB-S-002`: Apply後のexact after stateからRollbackし、before snapshotのhashとrow集合へ完全に復元する。
- `GM-IB-S-003`: 保存済みsnapshot改変、新規orphan、baseline外endpointへのアクセスはmutation前に拒否する。

## Evidence and Completion

- service/engineのfocused unit test 12件を同じGit HEADで通す。
- SSH tunnel経由の本番PostgreSQLでは一時schemaだけを作成・破棄し、3件のroundtrip testを同じGit HEADで通す。
- VibeProの機械可読verification artifactと独立Gate reviewを同じGit HEADへ束縛する。

## Out of Scope

- 既存orphan自体の一括修復
- schema migration
- API/MCP契約の変更
