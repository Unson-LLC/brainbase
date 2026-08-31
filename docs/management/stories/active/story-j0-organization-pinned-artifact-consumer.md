---
story_id: story-j0-organization-pinned-artifact-consumer
title: 組織版が固定commitのJ0 artifact契約をそのまま利用できる
status: done
architecture:
  - docs/architecture/ADR-022-oss-common-core-and-organization-superset.md
spec:
  - docs/specs/story-j0-organization-pinned-artifact-consumer-spec.md
created_at: 2026-08-31
updated_at: 2026-08-31
---

# 組織版が固定commitのJ0 artifact契約をそのまま利用できる

## Story

Brainbase組織版の運用者として、公開OSSのJ0 run artifact契約を固定commitのpackage dependencyから利用したい。これにより、組織版へsource copyや意味の異なる再実装を持ち込まず、run input、output、DAG、runner versionをプロセスを越えて保存・再読込できる。

## 受け入れ基準

- [x] AC-001: `@unson/brainbase-mcp`を公開側の検証済みcommit `9c0343c6b967cd34e1a45ed2d7c25d1c3f8ff3ae`へnpmのGitHub exact dependencyでpinする。
- [x] AC-002: 組織版consumerが公開subpath `@unson/brainbase-mcp/judgment-dag`だけをimportし、artifact storeのsource copyまたはsemantic forkを追加しない。
- [x] AC-003: process Aでrun recordを保存し、独立したprocess Bで同一artifactを検証付きreloadできる。
- [x] AC-004: reload後もrun input、DAG、execution order、runner versions、node input/outputが一致し、reload中にrunnerを再実行しない。
- [x] AC-005: package manifestとlock readbackが同じexact dependencyを示し、focused consumer E2Eとtypecheckがpassする。
- [x] AC-006: 独立レビューでblocking findingがなく、npm公開、deploy、本番変更、権限契約変更を行わない。

## スコープ外

- replay、evaluation、artifact list、高度なfault recovery
- 組織Graph/PostgreSQL adapterへの切替
- npm公開、deploy、本番runtime変更

これらはR1以降の責務とする。
