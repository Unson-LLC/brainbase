---
spec_id: SPEC-companion-canonical-task-provider
title: Mac Companion Canonical Task Provider Spec
status: active
date: 2026-07-14
story_id: story-companion-canonical-task-provider
related_architecture:
  - docs/architecture/story-companion-canonical-task-provider.md
implementation_files:
  - server/bootstrap/core-services.js
  - server/bootstrap/register-api-routes.js
  - server/controllers/companion-controller.js
  - server/routes/companion.js
  - server/services/companion/canonical-task-service.js
  - server/services/companion/canonical-task-nocodb-repository.js
  - server/services/companion/canonical-task-operation-repository.js
  - server/services/workflow/workflow-service.js
  - server/services/workflow/workflow-repository.js
  - server/routes/workflows.js
  - server/sql/canonical-task-operation-schema.sql
  - scripts/migrate-canonical-task-columns.js
  - scripts/migrate-canonical-task-operations.js
  - package.json
test_files:
  - tests/e2e/story-companion-canonical-task-provider-contract.spec.ts
  - tests/server/routes/companion-canonical-tasks.test.js
  - tests/server/services/canonical-task-service.test.js
  - tests/server/services/canonical-task-nocodb-repository.test.js
  - tests/server/services/canonical-task-operation-repository.test.js
  - tests/server/services/workflow-canonical-task-materialization.test.js
  - tests/server/routes/companion-approval-inbox.test.js
  - tests/server/services/workflow-org-agent-control.test.js
  - tests/fixtures/companion-canonical-task-mac-b392fdec.json
---

# Mac Companion Canonical Task Provider Spec

## 不変条件

- **INV-1 single-ssot**: Taskの永続化正本はBrainbaseの既存NocoDB Task表だけである。
- **INV-2 person-authority**: 担当者の権威値はGraph SSOTの `person_id` であり、自由入力名は投影に限る。
- **INV-3 no-guessing**: `person_id` のない既存担当者名を名前一致で自動正規化しない。
- **INV-4 optimistic-version**: 全変更は期待版を検証し、成功時だけ版を増加する。
- **INV-5 idempotent-create**: 作成は冪等キーとfingerprintを保存し、同じ要求を重複作成しない。
- **INV-6 materialize-before-approve**: `task_store` 承認は全Taskが正本化された後だけapprovedになる。
- **INV-7 fail-closed**: 正本またはPeople確認が失敗した場合は明示的に失敗し、空・未担当へ変換しない。
- **INV-8 audit**: 作成、更新、状態遷移、承認由来作成はactorと発生元を監査ログに残す。
- **INV-9 compatibility**: 既存NocoDB Task APIと非Task承認の契約を変更しない。
- **INV-10 access**: Companion認証・owner境界の外からTaskを読み書きできない。
- **INV-11 durable-coordination**: 同じ冪等キー、Task版、human stepの実行権はPostgresの調停台帳で一意にclaimし、process内lockを正しさの根拠にしない。
- **INV-12 canonical-store-scope**: 正本storeはbase `pva7l2qlu6fdfip`、table `m7iys8m7o1abr3f` に固定し、要求からstoreを選択させない。環境変数で上書きする場合も起動時検査で一組に確定する。
- **INV-13 destination-idempotency**: createの冪等キーはNocoDB正本表で一意にする。operation leaseは実行順を調停するが、外部書き込みの一意性根拠にはしない。
- **INV-14 mutation-recovery**: update/transitionは `expected_version`, 最終操作key, fingerprint, 次版を同じNocoDB row patchへ保存し、停止後はそのマーカーだけから適用済みを判定する。
- **INV-15 workflow-recovery-authority**: human stepの全Task ID、候補checkpoint、fencing generation、後処理phaseはPostgres台帳を回復権限とし、Workflow JSON metadataは互換投影とする。
- **INV-16 mac-wire-contract**: Mac consumer commit `b392fdec` の固定fixtureをHTTP schemaの権限とし、互換aliasだけで必須field欠落を隠さない。

## Task契約

Taskは `id`, `title`, `description`, `status`, `priority`, `assignee_person_id`,
`assignee_display_name`, `due_at`, `waiting_on`, `review_at`, `completed_at`,
`source_refs`, `version`, `created_at`, `updated_at`, `web_url`,
`normalization_warnings` を返す。

`id` はstore schema version、固定base/table、NocoDB record IDを署名付きで束ねた不透明IDとする。
復号したbase/tableが起動時に確定した正本storeと一致しなければ404にし、別projectへ配送しない。

状態は `pending`, `in_progress`, `waiting`, `completed`。優先度は
`low`, `medium`, `high`, `urgent`。日時はISO 8601、未設定はnullである。

一覧は必ず `{ items, total_count, count_status, next_cursor, read_status, warnings, as_of }`
を返す。完全に読み切れた場合は `read_status=complete`, `count_status=exact` とし、部分取得や
下流障害を0件へ変換しない。単体取得、作成、更新、遷移はTask objectを直接返す。

## シナリオ

- **SC-001 list and cursor**: `requested -> auth_checked -> filters_validated -> task_store_read -> normalized -> cursor_page_returned`
- **SC-002 idempotent create**: `requested -> key_validated -> person_verified -> key_absent -> task_created -> audited`; 再送は `key_found -> fingerprint_equal -> existing_returned`。
- **SC-003 idempotency collision**: 同じkeyでfingerprintが違う場合は `key_found -> fingerprint_mismatch -> 409` で書き換えない。
- **SC-004 versioned update**: `requested -> expected_version_checked -> patch_applied -> version_incremented -> audited`。不一致はcurrent Task付き409。
- **SC-005 waiting transition**: waitingへの遷移は `waiting_on` を必須にし、`review_at` を保存する。
- **SC-006 completed transition**: completedへの遷移は `completed_at` をサーバー時刻で保存する。completed以外へ戻すとnullにする。
- **SC-007 unresolved legacy assignee**: 担当者名だけの旧行はnull IDとwarningを返し、People検索を行わない。
- **SC-008 invalid person**: Graphにない `person_id` は422で、Taskを作成・更新しない。
- **SC-009 store unavailable**: NocoDB失敗は503で、空一覧を返さない。
- **SC-010 approval materialization**: `pending human step -> candidates loaded -> deterministic keys -> all tasks materialized -> ids persisted -> approved -> audited`。
- **SC-011 approval retry**: 応答消失後の同じapproveは `approved step -> materialized ids loaded -> same response` となりTaskを増やさない。
- **SC-012 approval failure**: 1件でもTask作成に失敗した場合は `materialization_failed -> step remains pending` となる。
- **SC-013 non-task approval compatibility**: `write_back_target != task_store` は既存resolve経路を通る。
- **SC-014 auth rejection**: 未認証またはownerでない要求はTask storeへ到達しない。
- **SC-015 concurrent create**: 同じkeyの並行POSTは永続claimの勝者だけがNocoDBへcreateし、他方は完了結果を読み同じTaskを返す。
- **SC-016 concurrent approval**: 同じstepの並行approveはstep claimの勝者だけがmaterializeし、他方は保存済み結果を再生する。
- **SC-017 recovery matrix**: Task作成、candidate checkpoint、全ID保存、approval更新、workflow audit、run更新の各境界で停止しても再送で前進し、Taskを増やさない。
- **SC-018 cross-owner rejection**: owner credentialは自分または未担当Taskだけを扱い、別person指定・別person Taskの更新を403にする。
- **SC-019 get by opaque id**: 固定storeのopaque IDを復号して単体Taskを返し、別storeまたは不存在IDは404 `task_not_found`。
- **SC-020 destination unique takeover**: worker Aのlease後にworker Bが引き継ぎ、Aが遅延createしてもNocoDBの冪等キー一意制約により1行だけとなり、両者は同じTask IDを回収する。
- **SC-021 mutation crash recovery**: NocoDB patch後・operation完了前の再送は、現行版が期待版+1かつ最終操作key/fingerprint一致なら適用済みTaskを返す。不一致なら409で自動再適用しない。
- **SC-022 workflow phase recovery**: Task ID群保存後の停止はPostgresのphase/result JSONから後処理だけ再開し、各phase更新は最新fencing generationを必須とする。
- **SC-023 task-store approval authorization**: human-step解決権限があるowner/admin/ceoでも、選択担当者がconfigured owner以外なら403。service/internalだけはGraph確認済み別personを許可する。
- **SC-024 Mac wire fixture**: 固定fixtureで一覧完全性field、GET単体、`to_status`、`version_conflict`、トップレベル `materialized_task_ids` を実routeで再生する。

## HTTP

### 一覧

`GET /api/companion/tasks?status=pending&assignee_person_id=person_x&due=overdue&limit=50&cursor=...`

成功: `{ "items": [...], "total_count": 1, "count_status": "exact", "next_cursor": null, "read_status": "complete", "warnings": [], "as_of": "..." }`

owner credentialでは `assignee_person_id` は設定ownerと同値だけを許可し、省略時もserverがownerへ固定する。
service/internal credentialだけがGraphで確認済みの別personを指定できる。どの認証種別もproject/base/tableは指定できない。

### 単体取得

`GET /api/companion/tasks/:taskId` はTask objectを直接返す。opaque IDのstore scopeを検証し、
固定store以外または不存在の場合は404 `{ "code": "task_not_found", "message": "..." }` とする。

### 作成

`POST /api/companion/tasks` は `Idempotency-Key` headerを必須とし、bodyに `title`,
任意の `description`, `priority`, `assignee_person_id`, `due_at`, `source_refs` を受ける。

### 更新

`PATCH /api/companion/tasks/:taskId` はbodyの `expected_version` を必須とする。変更可能なのは
title、description、priority、assignee_person_id、due_atである。

### 状態遷移

`POST /api/companion/tasks/:taskId/transitions` は `expected_version`, `to_status` と、waiting時の
`waiting_on`, 任意の `review_at` を受ける。

### 認証と認可

| 認証種別 | list | create | update/transition |
|---|---|---|---|
| bearer / insecure-header | configured ownerへserver-side scope | owner担当だけ | owner担当または未担当だけ |
| service-token / internal | 固定正本store内、明示person filter可 | Graph確認済みperson可 | 固定正本store内で可 |

全操作はactor personまたはservice principal、auth source、固定project `brainbase` を監査へ記録する。
`task_store` 承認はこの表とは別に既存 `_assertActorCanResolveHumanStep` を先に通し、その後に
Task owner境界を通す。bearer/insecure-header/admin/ceoはconfigured ownerだけを選択可能とし、
service-token/internalだけがGraph確認済みの別personをmaterializeできる。両resolve routeは
`WorkflowService.resolveHumanStep` の同一規則を使う。

### 承認候補と結果

- object候補は識別子として既存producerの `id` またはMac review itemの `candidate_id`、`title`、
  `selected_owner_id`、`owner_resolution.status=resolved|already_selected` を受ける。`already_selected`
  はselected IDがGraph Peopleに再確認できる場合だけ有効とする。
- `unresolved`、`ambiguous`、`ignored`、legacy文字列候補はTask化せず、stepをpendingのまま409
  `task_candidates_require_owner_resolution` と候補別理由を返す。
- 冪等keyは `workflow-output:<outputId>:<candidateFingerprint>:<sameFingerprintOrdinal>` とし、
  並べ替えでは変化せず、完全に同じ重複候補だけordinalで区別する。
- fingerprintはnormalized candidate ID、trim済みtitle/description、selected owner ID、priority、due、
  sort済みsource refsのcanonical JSONから作り、配列位置・表示名・resolution説明は除外する。
- Postgres operation result JSONへ候補key別Task ID、完了状態、警告を1件ごとにcheckpointし、
  human step metadataの `canonical_task_materialization` へ互換投影する。
- 成功応答は既存キーを保った `{ human_step, resumed_run, materialized_task_ids, materialization: { status, task_ids, excluded_candidates, warnings, replayed } }`。
  `materialized_task_ids` は `materialization.task_ids` と常に同値で、省略しない。
  部分失敗は同じ構造とerror codeを返すがapprovedにしない。

### 永続調停と回復

`canonical_task_operations(scope, operation_key)` の一意制約でcreate key、
`task-mutation:<opaqueTaskId>:<expectedVersion>`、human step IDをclaimする。台帳はTask本文を持たず、
fingerprint、状態、lease、fencing generation、result JSON、後処理phaseを持つ。claim中のworker停止は
lease満了後にgenerationを増やして引き継ぎ、各checkpoint/phase更新はowner tokenとgeneration一致を必須にする。

createはさらにNocoDBの `冪等キー` 列へDB一意制約を設定する。重複insertはキー検索で既存行を
回収し、fingerprint一致なら同じTask、違えば409にする。update/transitionは同じscopeを共有し、
NocoDB rowへ `最終操作キー`, `最終操作Fingerprint`, 次版を業務変更と同じPATCHで保存する。
現行版が期待版+1でもマーカーが一致しない場合は `version_conflict` とし、適用済みと推測しない。

| 停止点 | 再送時の期待 |
|---|---|
| 一部Task作成後 | deterministic keyで既存Taskを取得し、未作成候補から続行 |
| Task作成後・candidate checkpoint前 | create keyの完了結果からIDを復元してcheckpoint |
| 全ID保存後・approved前 | providerを呼ばずapprovedへ進める |
| approved後・audit/run更新前 | Postgres phase/resultを再生し、最新fenceを確認して未完了の後処理だけ進める |
| approvedだがID metadata欠落 | deterministic key群から全IDを復元できる場合だけ修復し、不足時は409 |
| 同時approve | destination uniqueとstep claimで外部書き込みを同一結果へ収束させ、他方は完了を待って同じ結果を返す |

### Migrationとrelease順序

1. `node scripts/migrate-canonical-task-operations.js --apply` 後に `--check` し、Brainbaseの
   InfoSSOT Postgres接続設定でoperation schema、unique key、result JSON、phase、generationを確認する。
2. `node scripts/migrate-canonical-task-columns.js --apply` 後に `--check` し、固定NocoDB Task表の
   必須列と `冪等キー` のDB一意制約を確認する。metadata APIが一意制約を作れない環境ではapplyを
   成功扱いせず、管理DB migrationが完了するまでTask書き込みを有効にしない。
3. Brainbase APIを再起動し、fixtureによる実route契約と回帰を確認する。
4. Mac Companionを反映する。rollback時も追加列・schemaは削除せず、APIを先にrevertする。

## 検証

- BDDで24シナリオをAPIとserviceの実経路へ対応付け、修正前に新規fixtureが失敗することを記録する。
- NocoDB repositoryはfake fetchでfield mapping、cursor、冪等照会、版更新を検証する。
- Workflow serviceは実repository ledgerとfake canonical task serviceで承認順序と再試行を検証する。
- 既存Companion認証、approval inbox、NocoDB Task controllerの回帰テストを実行する。
- Mac consumer契約は `tests/fixtures/companion-canonical-task-mac-b392fdec.json` に固定し、
  `/Users/ksato/workspace/code/brainbase-mac-companion` のconsumer基準`b392fdec`とschema hashを照合する。
- 既存 `/api/nocodb/tasks`、`/api/workflow-runs/:runId/human-steps/:stepId/resolve`、
  `/api/workflow-human-steps/:stepId/resolve`、非`task_store`承認を明示回帰対象にする。
