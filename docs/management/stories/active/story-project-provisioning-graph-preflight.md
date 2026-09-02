---
story_id: story-project-provisioning-graph-preflight
title: プロジェクト登録前にGraph同一ID衝突を検出する
status: done
created_at: 2026-09-02
updated_at: 2026-09-02
horizon: now
view: platform
architecture_reason: "Registry書込後のGraph適用で初めて同一ID衝突が判明する部分失敗をなくし、Project Provisioningのcheckを実際の書込境界と一致させるため。"
spec_docs:
  - path: .vibepro/spec/story-project-provisioning-graph-preflight/spec.json
    status: final
---

# プロジェクト登録前にGraph同一ID衝突を検出する

## User Story

Brainbaseのプロジェクト管理者として、既存Graphに同じプロジェクトIDがある場合は、登録処理を始める前に安全に再利用できるか判断したい。そうすれば、Registryだけ登録された`partial_failed`を作らず、完全一致の既存Project subjectだけを再利用できる。

## Acceptance Criteria

- [x] AC-001: `check`は、組織内外を問わず同じGraph entity IDの存在を、テナント情報を漏らさない限定readbackで確認する。
- [x] AC-002: 同一組織の完全一致Project subjectは衝突にせず、後続のGraph stepで再利用できる。
- [x] AC-003: 別組織の同一ID、同一組織でも型・状態・Catalog identityが不一致の同一ID、または既存subjectのscopeへアクセスできない状態は、`writes_performed: 0`の`check`で拒否する。
- [x] AC-004: display name／aliasの既存衝突検査と、Graph適用時のtenant guardは弱めない。
- [x] AC-005: PostgreSQLの限定関数、Repository、Serviceの回帰テストで、互換・不整合・別組織・不在を区別する。
- [x] AC-006: 配備前に保存された`project-provisioning-plan.v1`とGraph作成後に中断したrunは、適用直前の限定readbackと完了Receiptを照合し、安全な場合だけ再開できる。

## Scenarios

- `PP-GP-S-001`: 同一組織の別scopeに完全一致subjectがあり、operatorがそのscopeへアクセスできる場合、checkを通過する。
- `PP-GP-S-002`: 同一IDのsubjectが別組織または不整合の場合、書込前に衝突として停止する。
- `PP-GP-S-003`: 同一組織でも既存scopeへアクセスできない場合、scopeを自動拡張せず停止する。
- `PP-GP-S-004`: 同一IDが存在しない場合、従来の新規登録経路を維持する。
- `PP-GP-S-005`: 旧planにGraph preflightがなくても、不在は再開し、不整合は最初の書込前に停止する。
- `PP-GP-S-006`: Graph新規作成後に後続stepで失敗しても、当該runの完了Receiptと対象subjectが完全一致すればGraphを再作成せず再開する。

## Evidence and Completion

- 対象unit testとPostgreSQL統合試験を同じGit HEADで通す。
- VibeProの検証証跡と独立レビューを同じGit HEADへ束縛する。

## Out of Scope

- Graph entityの自動rehome
- 別組織からのProject所有権移管
- 既存の不整合Project subjectの自動修復
- Growinの議事録やコンテンツの移設
