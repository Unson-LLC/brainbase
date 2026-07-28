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

- `docs/specs/story-canonical-task-postgres-ssot-spec.md` の全契約を実装・検証する。
- Graphify、Architecture、Spec、Task、Gate、PRのVibePro証跡が現在HEADに結び付く。
- 本番切替前の運用境界と後続Canvas Storyが明示されている。
