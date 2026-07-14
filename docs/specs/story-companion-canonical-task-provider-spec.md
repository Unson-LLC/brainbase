---
spec_id: SPEC-companion-canonical-task-provider
title: Mac Companion Canonical Task Provider Spec
status: active
date: 2026-07-14
story_id: story-companion-canonical-task-provider
related_architecture:
  - docs/architecture/story-companion-canonical-task-provider.md
  - docs/architecture/ADR-016-canonical-task-single-writer.md
implementation_files:
  - server/bootstrap/core-services.js
  - server/bootstrap/register-api-routes.js
  - server/bootstrap/graceful-shutdown.js
  - server.js
  - server/controllers/companion-controller.js
  - server/routes/companion.js
  - server/services/companion/canonical-task-service.js
  - server/services/companion/canonical-task-nocodb-repository.js
  - server/services/companion/canonical-task-operation-repository.js
  - server/services/workflow/workflow-service.js
  - server/services/workflow/workflow-repository.js
  - server/routes/workflows.js
  - server/routes/nocodb.js
  - server/controllers/nocodb-controller.js
  - public/modules/domain/nocodb-task/nocodb-task-adapter.js
  - public/modules/utils/task-filters.js
  - server/sql/canonical-task-operation-schema.sql
  - scripts/migrate-canonical-task-columns.js
  - scripts/migrate-canonical-task-operations.js
  - scripts/recover-canonical-task-writer.js
  - scripts/add-frame-story-tasks.js
  - scripts/add-framework-operation-tasks.js
  - scripts/complete-doc-tasks.js
  - scripts/update-task-status.js
  - package.json
test_files:
  - tests/e2e/story-companion-canonical-task-provider-contract.spec.ts
  - tests/server/routes/companion-canonical-tasks.test.js
  - tests/server/services/canonical-task-service.test.js
  - tests/server/services/canonical-task-nocodb-repository.test.js
  - tests/server/services/canonical-task-operation-repository.test.js
  - tests/server/services/workflow-canonical-task-materialization.test.js
  - tests/server/routes/companion-approval-inbox.test.js
  - tests/server/controllers/nocodb-canonical-task-write-guard.test.js
  - tests/server/scripts/canonical-task-writer-policy.test.js
  - tests/server/services/workflow-org-agent-control.test.js
  - tests/server/routes/workflows.test.js
  - tests/server/controllers/nocodb-controller.test.js
  - tests/server/bootstrap/canonical-task-writer-lifecycle.test.js
  - tests/server/lib/graceful-cleanup.test.js
  - tests/server/scripts/recover-canonical-task-writer.test.js
  - tests/domain/nocodb-task/nocodb-task-adapter.test.js
  - tests/ui/views/nocodb-tasks-view.test.js
  - tests/fixtures/companion-canonical-task-mac-cb9c293.json
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
- **INV-9 compatibility**: 既存NocoDB Task APIの読取、正本base以外の書込、非Task承認は変更しない。正本baseへの旧Task mutationはCanonical Task APIへ一本化するため明示拒否する。
- **INV-10 access**: Companion認証・owner境界の外からTaskを読み書きできない。
- **INV-11 single-writer-coordination**: Task mutationと`task_store`承認はPostgresの永続writer tokenを持つ単一Brainbase processだけが実行する。別processは503とし、tokenを自動takeoverしない。
- **INV-12 canonical-store-scope**: 正本storeはbase `pva7l2qlu6fdfip`、table `m7iys8m7o1abr3f` に固定し、要求からstoreを選択させない。環境変数で上書きする場合も起動時検査で一組に確定する。
- **INV-13 destination-idempotency**: createの冪等キーはNocoDB正本表で一意にする。operation claimは単一writer内の実行順を調停するが、外部書き込みの一意性根拠にはしない。
- **INV-14 mutation-recovery**: update/transitionは `expected_version`, 最終操作key, fingerprint, 次版を同じNocoDB row patchへ保存し、停止後はそのマーカーだけから適用済みを判定する。旧writer停止確認前のtakeoverは禁止する。
- **INV-15 workflow-recovery-authority**: human stepの全Task ID、候補checkpoint、human step/runの目標状態、監査checkpoint、後処理phaseはPostgres台帳を回復権限とし、Workflow JSONは起動時と読取・再試行前に再投影する。
- **INV-16 mac-wire-contract**: Mac consumer commit `cb9c293` の固定fixtureをHTTP schemaの権限とし、互換aliasだけで必須field欠落を隠さない。
- **INV-17 owner-private-scope**: owner credentialの読取対象はconfigured owner担当Taskだけである。作成時の担当者省略はownerへ補完し、未担当・別person Taskの存在をownerへ開示しない。
- **INV-18 terminal-completed**: `completed` は終端であり、状態遷移は公開された許可表に従う。
- **INV-19 decision-pair**: `decision_mode` と `resolution` は公開対応表の同じ判断を表し、不一致はTask書込前に422で拒否する。
- **INV-20 explicit-overrides**: review itemの表示値は元候補を上書きしない。`edited_fields` に列挙された許可fieldだけを編集権限として扱う。
- **INV-21 idempotent-projection-audit**: workflow再投影の監査IDはoperationとphaseから決定し、同じIDをupsertして再試行で監査行を増やさない。
- **INV-22 no-canonical-writer-bypass**: 正本base/tableを変更するHTTP routeと運用scriptはCanonicalTaskServiceのwriter claim、People検証、版、監査を迂回しない。旧routeは正本base mutationをNocoDB到達前に拒否する。
- **INV-23 disjoint-idempotency-namespaces**: 外部create keyとWorkflow生成keyはserver-sideで異なる保存namespaceへ変換し、client文字列を正本列へそのまま保存しない。
- **INV-24 candidate-compatibility**: 既存の文字列候補とobject候補を同じ権限付き候補へ正規化し、並べ替えに依存しない内容由来IDを投影する。文字列の担当者は未解決のまま保持し、自動名寄せしない。
- **INV-25 legacy-projection**: 正本の`waiting`/`urgent`を既存NocoDB Task UIでも同じ意味へ双方向投影し、未知値を`pending`/`medium`へ黙って変換しない。

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

合法な一覧metadataは次だけとする。

| read_status | count_status | total_count | warnings |
|---|---|---|---|
| `complete` | `exact` | 0以上の整数 | 0件以上 |
| `partial` | `lower_bound` | `items.count` 以上の整数 | 1件以上 |
| `partial` | `unknown` | null | 1件以上 |
| `stale` | `unknown` | null | 1件以上 |

v1はlast-known cacheを持たないため`stale`を生成しないが、Mac decoder互換fixtureとして保持する。
NocoDBやGraphの通信失敗は`partial`や`stale`ではなく503である。`warnings` の各要素は
`{ "code": String, "message": String, "source_ref"?: { "type": String, "id": String, "url"?: String } }`
とし、文字列だけのwarningを返さない。

## シナリオ

- **SC-001 list and cursor**: `requested -> auth_checked -> filters_validated -> task_store_read -> normalized -> cursor_page_returned`
- **SC-002 idempotent create**: `requested -> key_validated -> person_verified -> key_absent -> task_created -> audited`; 再送は `key_found -> fingerprint_equal -> existing_returned`。
- **SC-003 idempotency collision**: 同じkeyでfingerprintが違う場合は `key_found -> fingerprint_mismatch -> 409` で書き換えない。
- **SC-004 versioned update**: `requested -> expected_version_checked -> patch_applied -> version_incremented -> audited`。不一致はcurrent Task付き409。
- **SC-005 waiting transition**: waitingへの遷移は `waiting_on` を必須にし、`review_at` を保存する。
- **SC-006 completed transition**: completedへの遷移は `completed_at` をサーバー時刻で保存する。completedからの遷移は409 `invalid_transition` にする。
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
- **SC-018 cross-owner rejection**: owner credentialはconfigured owner担当Taskだけを扱う。作成時の省略はowner補完、未担当・別personの読取は404、担当解除・別person指定は403にする。
- **SC-019 get by opaque id**: 固定storeのopaque IDを復号する。ownerにはowner担当Taskだけを返し、別store、不存在、未担当、別personは404 `task_not_found`。service/internalは固定store内の未担当・別personを取得できる。
- **SC-020 single writer**: writer Aがtokenを保持中はprocess Bのmutationと`task_store`承認を503にする。A異常終了後も自動takeoverせず、旧process停止を確認した明示回復後だけBが未完了operationを再開する。
- **SC-021 mutation crash recovery**: NocoDB patch後・operation完了前の再送は、現行版が期待版+1かつ最終操作key/fingerprint一致なら適用済みTaskを返す。不一致なら409で自動再適用しない。
- **SC-022 workflow phase recovery**: Task ID群保存後の停止はPostgresのphase/result JSONからhuman step、run、auditの目標状態をWorkflow JSONへ再投影し、未完了の後処理だけ再開する。
- **SC-023 task-store approval authorization**: 両resolve routeでhuman-step解決権限を持つactorは、承認候補をactor付きinternal commandとして渡し、Graph確認済み別personへmaterializeできる。同じactorがbearerで直接Task APIから別personをcreate/updateする要求は403にする。
- **SC-024 Mac wire fixture**: 固定fixtureで反復status/priority、due bounds、cursor、limit、合法な一覧metadata、GET単体、`to_status`、`version_conflict`、`invalid_transition`、トップレベル `materialized_task_ids` を実routeで再生する。
- **SC-025 review item merge**: unresolvedな元候補をMac review itemの`selected_owner_id`で解決し、編集済みTask fieldを合成してGraph再確認後に作成する。
- **SC-026 review item decisions**: approvedだけをTask化し、rejectedは明示的に除外する。needs_changesが1件でもあればstepをpendingのまま409にする。
- **SC-027 decision pair validation**: top-levelとreview itemの`decision_mode`/`resolution`が対応表と不一致なら422となり、Taskとhuman stepを変更しない。reject混在と全件rejectはapproved exclusionとして到達できる。
- **SC-028 writer lifecycle**: HTTP listen前にclaim/reconcileし、graceful shutdownでreleaseする。claim失敗時のmutationは503、expected token明示回復後は未完了operationから再開する。
- **SC-029 idempotent audit projection**: approved後・audit/run更新前に停止して起動、getRun、approval inbox、retryを繰り返しても、同じoperation/phaseの監査IDは1件だけである。
- **SC-030 legacy canonical write guard**: `/api/nocodb/tasks` のcreate/update/deleteで正本baseを指定すると409 `canonical_task_api_required` となり、NocoDB fetchは呼ばれない。正本base以外と読取は既存契約を維持する。
- **SC-031 operational writer migration**: 正本tableを直接呼ぶ4本の運用scriptは認証済み`/api/companion/tasks` create/update/transitionへ移行し、固定table IDとNocoDB write URLを含まない。
- **SC-032 cross-source idempotency isolation**: 同じclient文字列を送っても直接APIは`api:<principal>:<key>`、Workflowは`workflow:<output>:<fingerprint>:<ordinal>`を保存し、互いのoperation/result/approval summaryへ衝突しない。
- **SC-033 legacy string candidate compatibility**: 既存fixtureの文字列候補を`title`と未解決ownerを持つ候補へ正規化し、approval inboxと両resolve routeで同じ内容由来`candidate_id`を使う。Mac review itemでGraph確認済みownerを選ぶと一度だけTask化し、未選択なら409でpendingに残す。
- **SC-034 reorder-stable candidate identity**: IDなしobject候補と文字列候補を並べ替えて再投影しても、候補内容ハッシュと同一内容内ordinalから同じcandidate ID集合・Workflow冪等key集合を生成し、停止・再試行後もTaskを増やさない。
- **SC-035 legacy lifecycle projection**: 既存NocoDB adapterは`waiting`を`待ち`、`urgent`を`緊急`へ双方向変換し、未知status/priorityは明示的なunknown値またはwarningとして保持して`pending`/`medium`へ縮退しない。

## HTTP

### 一覧

`GET /api/companion/tasks?status=pending&status=waiting&priority=high&priority=urgent&assignee_person_id=person_x&due_after=...&due_before=...&limit=50&cursor=...`

成功: `{ "items": [...], "total_count": 1, "count_status": "exact", "next_cursor": null, "read_status": "complete", "warnings": [], "as_of": "..." }`

owner credentialでは `assignee_person_id` は設定ownerと同値だけを許可し、省略時もserverがownerへ固定する。
service/internal credentialだけがGraphで確認済みの別personを指定できる。どの認証種別もproject/base/tableは指定できない。
反復`status`と`priority`は各field内でOR、異なるfield間はANDとする。`due_after`と`due_before`は
ISO 8601の包含境界で、null期限は除外する。`due_after > due_before`、未知enum、不正日時、不正cursor、
1未満または50超の`limit`は422 `validation_failed` とfield別errorを返す。

### 単体取得

`GET /api/companion/tasks/:taskId` はTask objectを直接返す。opaque IDのstore scopeを検証し、
固定store以外または不存在の場合は404 `{ "code": "task_not_found", "message": "..." }` とする。
owner credentialでは未担当・別personのTaskも情報非開示のため同じ404にする。

### 作成

`POST /api/companion/tasks` は `Idempotency-Key` headerを必須とし、bodyに `title`,
任意の `description`, `priority`, `assignee_person_id`, `due_at`, `source_refs` を受ける。
owner credentialで`assignee_person_id`省略時はconfigured ownerを保存する。ownerが別personを指定した
場合は403。service/internalでは省略を未担当として保存できる。
headerはclient keyであり、`api:`または`workflow:`から始まる予約prefixは422
`reserved_idempotency_prefix`にする。保存keyはserverが`api:<actor-principal>:<client-key>`へ変換し、
client文字列を正本列へそのまま保存しない。

### 更新

`PATCH /api/companion/tasks/:taskId` はbodyの `expected_version` を必須とする。変更可能なのは
title、description、priority、assignee_person_id、due_atである。
ownerはconfigured owner担当Taskだけを更新でき、担当者nullまたは別personへの変更は403とする。

### 状態遷移

`POST /api/companion/tasks/:taskId/transitions` は `expected_version`, `to_status` と、waiting時の
`waiting_on`, 任意の `review_at` を受ける。

| 現在 | 許可する遷移先 |
|---|---|
| `pending` | `in_progress`, `waiting`, `completed` |
| `in_progress` | `waiting`, `completed` |
| `waiting` | `in_progress`, `completed` |
| `completed` | なし |

表にない遷移は409 `{ "code": "invalid_transition", "current_task": {...} }` とする。

### 認証と認可

| 認証種別 | list/get | create | update/transition |
|---|---|---|---|
| bearer / cookie | configured owner担当だけ。未担当・別personは404 | 省略時owner補完。別personは403 | owner担当だけ。担当解除・別personは403 |
| service-token / internal | 固定正本store内、明示person filterと未担当を扱える | 省略で未担当、Graph確認済みperson可 | 固定正本store内で可 |
| insecure-header | 403 `task_owner_identity_required` | 403 `task_owner_identity_required` | 403 `task_owner_identity_required` |

全操作はactor personまたはservice principal、auth source、固定project `brainbase` を監査へ記録する。
`task_store` 承認は直接Task API操作ではない。両resolve routeの既存workflow認証と
`_assertActorCanResolveHumanStep` を先に通し、承認済み候補だけをactor付きservice-internal commandとして
`CanonicalTaskService`へ渡す。このcommandはGraph確認済みの別personをmaterializeできるが、任意の
store/project指定はできない。したがって承認者が別担当者を選んでも、bearer credentialでそのTaskを
直接list/get/updateできる権限は増えない。

### 承認候補と結果

- approval inbox投影時に、文字列候補はtrim済み文字列を`title`、owner未解決を持つ互換objectへ正規化する。
  object候補も同じcanonical field集合へ正規化し、既存`id`/`candidate_id`は保持する。IDがない候補は
  `workflow-output:<outputId>:candidate:<candidateContentHash>:<sameContentOrdinal>`を投影する。
  `candidateContentHash`はtrim済みtitle/description、元owner IDまたは未解決状態、priority、due、sort済みsource refsの
  canonical JSONから作る。同一内容候補は内容ごとに個数を数えたordinal集合を割り当てるため、配列の並べ替えでID集合が変わらない。
  Macは返された`candidate_id`をそのまま返し、resolve時はこの正規化済み候補集合だけを権限とする。
  `response_ref.review_items`がある場合は`candidate_id`優先、なければ`id`で一対一に結合し、未知・重複・
  欠落itemは422にする。review itemがない既存clientは元候補だけを使う。文字列候補はowner未解決のため、
  review itemでGraph確認済みownerが選ばれない限りTask化しない。
- `decision_mode` と `resolution` の合法対応は `approve|approveWithEdits -> approved`,
  `requestChanges -> needs_changes`, `reject -> rejected` だけである。top-levelと全review itemで不一致は
  422 `inconsistent_approval_decision` とし、修正前fixtureで書込0件を確認する。
- top-level resolutionが`approved`のときだけmaterializeする。review itemの`approved`はTask化、
  `rejected`は`excluded_candidates`へ`rejected_by_reviewer`として記録し、`needs_changes`が1件でも
  あればstepをpendingのまま409にする。全件rejectedはTask 0件を明示してapprovedにできる。
- `requestChanges` itemが1件でもあればtop-levelは`needs_changes`、それ以外はrejectが混在または全件rejectでも
  top-levelを`approved`にする。top-level `reject` はcard全体をTask化せずrejectedで閉じる。
- review itemの`title`, `description`, `priority`, `due_at`, `assignee_person_id`は存在だけでは上書きしない。
  `edited_fields`に列挙されたfieldだけを上書きし、未知field、列挙したfieldの値欠落、非列挙fieldの元候補と
  異なる値は422にする。v1 Mac UIが編集権限を持つのは`assignee_person_id`だけである。
  `selected_owner_id`を担当者の最終判断とし、`assignee_person_id`もある場合は同値を必須にする。
  source refsと候補IDは元outputを権限としreview itemから追加・変更させない。
- review itemで選択されたownerは元候補の`owner_resolution`がunresolvedでも上書きできるが、Graphで
  再確認する。review itemに選択がない場合は元候補のresolved/already_selected ownerだけを受理する。
  最終ownerが未解決、ambiguous、ignored、legacy文字列だけなら409
  `task_candidates_require_owner_resolution` と候補別理由を返す。
- candidateの安定IDは上記の内容hash形式を使い、正本へ保存する冪等keyは
  `workflow:<outputId>:<candidateFingerprint>:<sameFingerprintOrdinal>` とし、
  並べ替えでは変化せず、完全に同じ重複候補だけordinalで区別する。
- fingerprintはtrim済みtitle/description、selected owner ID、priority、due、
  sort済みsource refsのcanonical JSONから作り、配列位置・表示名・resolution説明は除外する。
- Postgres operation result JSONへ候補key別Task ID、完了状態、警告を1件ごとにcheckpointし、
  human step metadataの `canonical_task_materialization` へ互換投影する。
- 成功応答は既存キーを保った `{ human_step, resumed_run, materialized_task_ids, materialization: { status, task_ids, excluded_candidates, warnings, replayed } }`。
  `materialized_task_ids` は `materialization.task_ids` と常に同値で、省略しない。
  部分失敗は同じ構造とerror codeを返すがapprovedにしない。

### 旧writerの遮断と移行

`/api/nocodb/tasks` のGETは既存一覧契約を維持する。POSTはmapping解決後、PUT/DELETEは`baseId`検証直後に、
固定正本base `pva7l2qlu6fdfip`なら409 `{ "code": "canonical_task_api_required" }` を返し、table解決・NocoDB writeを呼ばない。
他baseの挙動は変更しない。正本table `m7iys8m7o1abr3f`へ直接fetchしていた
`add-frame-story-tasks.js`、`add-framework-operation-tasks.js`、`complete-doc-tasks.js`、`update-task-status.js`は、
service tokenまたはinternal keyを使うCanonical Task API clientへ移行する。CI policy testで正本table IDと
`/api/v2/tables/.../records` writeの再導入を拒否する。

既存NocoDB UI adapterは正本列の`待ち`/`緊急`をそれぞれ`waiting`/`urgent`へ双方向変換する。
未知status/priorityは入力値を保持してUIへ明示し、`pending`/`medium`へ黙って縮退させない。

### 永続調停と回復

`canonical_task_writer`のsingleton rowでprocess tokenを永続化する。Task mutationと`task_store`承認は
active tokenを持つprocessだけが実行し、他processは503 `canonical_task_writer_unavailable` にする。
graceful shutdownはtokenをreleaseする。異常終了時は自動takeoverせず、運用者が旧process停止を確認して
`--recover-writer --expected-token <token>`を実行した場合だけ新tokenへ移譲する。

`canonical_task_operations(scope, operation_key)` の一意制約でcreate key、
`task-mutation:<opaqueTaskId>:<expectedVersion>`、human step IDをclaimする。台帳はTask本文を持たず、
fingerprint、状態、writer token、result JSON、human step/run目標状態、audit checkpoint、後処理phaseを持つ。

createはさらにNocoDBの `冪等キー` 列へDB一意制約を設定する。重複insertはキー検索で既存行を
回収し、fingerprint一致なら同じTask、違えば409にする。update/transitionは同じscopeを共有し、
NocoDB rowへ `最終操作キー`, `最終操作Fingerprint`, 次版を業務変更と同じPATCHで保存する。
現行版が期待版+1でもマーカーが一致しない場合は `version_conflict` とし、適用済みと推測しない。
`server.js`はHTTP listen前にwriterをclaimして未完了operationをreconcileする。claimまたはreconcileに
失敗しても読取serverは起動できるがTask mutationと`task_store`承認は503となる。
`registerGracefulShutdown`はHTTP close後、session cleanup前にwriter tokenをreleaseする。
`scripts/recover-canonical-task-writer.js --expected-token <token>`だけが旧tokenを比較して移譲し、旧processの
停止確認を要求する。起動時およびtask_store human stepの読取・resolve前に、未完了operationをPostgresから読み、保存済み
Task ID、human step/run目標状態、audit checkpointをWorkflow JSONへ冪等に再投影する。task_store以外の
Workflowは既存経路を変えない。

再投影監査は `canonical-task:<operationId>:<phase>` をIDとし、Workflow repositoryの`upsertAuditLog`で
同じIDを置換または維持する。`writeAuditLog`の既存append契約は非Task workflow向けに変更しない。

| 停止点 | 再送時の期待 |
|---|---|
| 一部Task作成後 | deterministic keyで既存Taskを取得し、未作成候補から続行 |
| Task作成後・candidate checkpoint前 | create keyの完了結果からIDを復元してcheckpoint |
| 全ID保存後・approved前 | providerを呼ばずapprovedへ進める |
| approved後・audit/run更新前 | Postgresの目標状態とcheckpointをWorkflow JSONへ再投影し、未完了の後処理だけ進める |
| approvedだがID metadata欠落 | deterministic key群から全IDを復元できる場合だけ修復し、不足時は409 |
| 同時approve | 単一writer内のstep claimとdestination uniqueで同一結果へ収束し、他方は同じ結果を返す |
| writer異常終了 | 自動takeoverせず503。旧process停止確認後の明示回復で同じoperationから再開 |

### Migrationとrelease順序

1. `node scripts/migrate-canonical-task-operations.js --apply` 後に `--check` し、Brainbaseの
   InfoSSOT Postgres接続設定でwriter singleton、operation schema、unique key、result JSON、目標状態、phaseを確認する。
2. `node scripts/migrate-canonical-task-columns.js --apply` 後に `--check` し、固定NocoDB Task表の
   必須列と `冪等キー` のDB一意制約を確認する。metadata APIが一意制約を作れない環境ではapplyを
   成功扱いせず、管理DB migrationが完了するまでTask書き込みを有効にしない。
3. 旧writerのgraceful releaseを確認してBrainbase APIを再起動し、writer tokenとfixtureによる実route契約・回帰を確認する。異常終了時だけ旧process停止確認後に明示回復する。
4. Mac Companionを反映する。rollback時も追加列・schemaは削除せず、APIを先にrevertする。

## 検証

- BDDで35シナリオをAPIとserviceの実経路へ対応付け、修正前に新規fixtureが失敗することを記録する。
- NocoDB repositoryはfake fetchでfield mapping、cursor、冪等照会、版更新を検証する。
- Workflow serviceは実repository ledgerとfake canonical task serviceで承認順序と再試行を検証する。
- 既存Companion認証、approval inbox、NocoDB Task controllerの回帰テストを実行する。
- Mac consumer契約は `tests/fixtures/companion-canonical-task-mac-cb9c293.json` に固定し、
  `/Users/ksato/workspace/code/brainbase-mac-companion` のconsumer基準`cb9c293`とschema hashを照合する。
- 既存 `/api/nocodb/tasks` の読取・非正本base書込・正本base write guard、`/api/workflow-runs/:runId/human-steps/:stepId/resolve`、
  `/api/workflow-human-steps/:stepId/resolve`、非`task_store`承認を明示回帰対象にする。
- server起動claim/reconcile、graceful release、明示回復CLI、`getRun`/approval inbox読取時reconcile、
  retry、非`task_store`、旧NocoDB API、4本の移行済み運用script、旧UIのwaiting/urgent投影、文字列候補、
  冪等key namespaceをcurrent-headのpath surface evidenceとapproval summary/gate artifactへ含める。
