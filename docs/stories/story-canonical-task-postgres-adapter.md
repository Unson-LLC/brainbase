---
story_id: story-canonical-task-postgres-adapter
title: OSS Canonical Task PostgreSQL adapter
status: in_progress
date: 2026-10-18
parent_story: story-canonical-task-service-kernel
related_specs:
  - docs/specs/canonical-task-postgres-adapter.md
---

# OSS Canonical Task PostgreSQL adapter

## Story

OSS Brainbaseの利用者として、Canonical Taskの保存・冪等性・楽観ロック・single-writer/readinessを、
会社固有の認証や組織モデルを持ち込まずにPostgreSQLへ接続したい。これにより、各ホストは自分の
authority、監査、tenant policyを注入しながら同じ公開Taskサービスを使える。

## Scope

- `canonical_tasks`、operation/readiness、readiness auditのSQL契約をOSSへ移す。
- 署名付きopaque ID、旧store IDの移行期間readback、exact count、keyset search、冪等create、
  version compare-and-swap update/deleteを提供する。
- completion contractの更新前に、row lock内でホストのauthority guardを実行する。
- backend未設定とidentity不一致をfail closedにする。

SQLファイルは契約として追加するだけで、本番DBへのapply、backend切替、旧Unson実装の削除、consumerの
既定切替は含めない。

## Acceptance criteria

1. PostgreSQL adapter、operation/readiness、store manifestが公開subpathからimportできる。
2. adapterのDB障害、未知/改ざん/別store ID、stale version、未設定backendが安易な成功や別storeへの
   fallbackにならない。
3. hostのscope visibility、mutation authority、監査をOSSのpolicy/audit injection境界で保持する。
4. single-writer、readiness identity、source-head rebind guard、operation idempotencyがSQLとunit testで
   検証される。
5. policy `storageScope`に対応する物理partition predicateが未提供の間は、adapterがscope付き操作を
   503で拒否し、scopeを混在させない。

## Out of scope

Graph authority、組織/RLSの具体的な判定、workflow固有の監査ledger、実DB migration、production
readback、旧Unson consumerの切替はホスト側の後続作業とする。
