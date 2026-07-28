---
story_id: story-canonical-task-postgres-ssot
title: Canonical Taskの正本をPostgreSQLへ移行する
status: active
date: 2026-07-28
related_architecture:
  - docs/architecture/story-canonical-task-postgres-ssot.md
related_specs:
  - docs/specs/story-canonical-task-postgres-ssot-spec.md
---

# Canonical Taskの正本をPostgreSQLへ移行する

## Who / Problem / Outcome

- **Who**: mana-runtimeをSlack上で使うUnsonチームと、Task運用を管理する佐藤。
- **Problem**: Canonical Task APIは存在するがTask本文の正本がNocoDBに残り、BrainbaseとSlack Canvasを
  中心にした運用では正本・投影・権限の境界が分かりにくい。
- **Outcome**: Task本文をBrainbase PostgreSQLへ集約し、NocoDBとSlack Canvasを再生成可能な投影として
  扱える。mana-runtimeはBrainbase APIだけを通じてTaskを読み書きできる。

## Scope

このStoryはPostgreSQL schema、repository、明示的backend選択、NocoDBからの移行検査を実装する。
公開API、People検証、single-writer、readiness、監査の契約は維持する。

本番DBへのapply、backend切替、NocoDB削除、Slack Canvas投影は含めない。Canvas投影は本Storyの
API契約を利用するmana-runtime側の後続Storyで実装する。

## Success Metrics

- repository契約と既存Canonical Task回帰テストが100% passする。
- migration dry-run/checkが件数と競合を本文・secretなしで報告できる。
- backend未指定時に本番挙動が変わらず、`postgres`指定時だけ新storeを使う。

## Acceptance Criteria

- **AC-1**: `docs/specs/story-canonical-task-postgres-ssot-spec.md` の全契約を実装・検証する。
- **AC-2**: Graphify、Architecture、Spec、Task、Gate、PRのVibePro証跡が現在HEADに結び付く。
- **AC-3**: 本番切替前の運用境界と後続Canvas Storyが明示されている。

## Scenarios

### S-001: 既存NocoDB運用を維持したまま配備する

`CANONICAL_TASK_BACKEND` が未指定ならNocoDBを選び、PostgreSQLへの暗黙切替を行わない。

### S-002: PostgreSQLを明示選択する

`CANONICAL_TASK_BACKEND=postgres` と有効な接続設定がある場合だけPostgreSQL repositoryを生成する。

### S-003: 移行前に安全な差分を確認する

operatorはdry-run/checkでsource、既存一致、未移行、競合の件数を確認でき、Task本文やsecretは出力されない。

### S-004: 競合なしで移行を適用する

applyは一つのtransactionで未移行Taskだけを保存し、再実行時は既存一致として扱う。

### S-005: IDまたは冪等キー競合で閉じる

legacy IDと冪等キーが別Taskを指す場合はapplyを中止し、Task本文を出さず競合件数だけを報告する。

### S-006: PostgreSQL障害を隠さない

選択したPostgreSQL storeの接続・query失敗は明示的な失敗となり、NocoDBや空一覧へfallbackしない。

## Delivery Evidence

- **Current reality**: Canonical Task APIとsingle-writer/readiness契約は稼働済みだが、本文の永続化はNocoDB repositoryが既定。
- **Failure modes**: backend誤指定、接続失敗、legacy IDまたは冪等キー競合、移行途中の失敗、別store IDの混入をfail-closedで扱う。
- **Done evidence**: repository・migration・bootstrap・既存service/routeの自動テスト、Story E2E contract、VibeProの現在HEAD束縛証跡を揃える。本番applyとbackend切替はDoneに含めない。

## Atomic PR Scope

schema、repository、backend選択、readiness identity、移行CLI、要求文書、契約テストは、旧正本を維持したまま
新storeを選択可能にする一つの原子的な変更である。いずれかだけを先行すると、選択不能なschema、検証不能な
migration、またはreadiness identityの不一致を生むため、本Storyでは同一PRでレビューする。Slack Canvas投影と
本番切替は独立した運用リスクを持つため、後続Storyへ分離する。
