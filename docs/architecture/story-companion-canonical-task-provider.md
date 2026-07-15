---
title: Companion Canonical Task Provider Architecture
status: proposed
date: 2026-07-14
story_id: story-companion-canonical-task-provider
related_decisions:
  - docs/architecture/ADR-016-canonical-task-single-writer.md
---

# Companion Canonical Task Provider Architecture

## 決定

Brainbaseプロジェクトの既存NocoDB Task表を個人Taskの正本として維持し、その上に
`CanonicalTaskService` を置く。Mac CompanionとWorkflow承認は必ずこのserviceを経由し、
NocoDBの自由入力列を直接Task権限として扱わない。

## 所有境界

| 層 | 所有するもの | 所有しないもの |
|---|---|---|
| Mac Companion | 一覧・入力・状態操作・エラー回復UI | Task正本、人物名寄せ、監査 |
| Companion Task API | 認証、入力検証、HTTP契約 | Taskの別保存 |
| CanonicalTaskService | 状態遷移、People ID検証、冪等性、版競合、監査 | UI |
| CanonicalTaskPrincipal | 認証済み権威IDからtyped principalと衝突しないnamespaceを生成 | body actor、表示名による同定 |
| CanonicalTaskReadiness | 永続readiness row、証跡照合、process-local mutation gate | Task本文、回帰試験そのもの |
| NocoDB Task repository | 既存Task表の永続化と検索 | 人物同定、業務判断 |
| Graph SSOT | `person_id` と表示名 | Task状態 |
| WorkflowService | 承認順序と再試行 | 独自Task作成ロジック |
| Canonical store manifest | Brainbase/MCP/migration共通のbase/table/owner/schema identity | processごとの個別override |
| NocoDB MCP | 正本Taskのread、正本以外の汎用操作 | 正本Taskのmutation |

## SSOT

- 正本テーブルはbase `pva7l2qlu6fdfip`、table `m7iys8m7o1abr3f` の `タスク` に固定する。
  client requestや複数project mappingから選択しない。環境変数で差し替えられるのは`CANONICAL_TASK_STORE_MANIFEST`によるmanifestパスだけであり、base/tableの個別overrideは拒否する。
- 正本storeのproject/owner scopeは `brainbase` / configured Personal KG ownerである。
  Task IDはstore schema versionと固定storeを結合した署名付きopaque IDとし、別store IDを拒否する。
- `担当者PersonID` が権威ある担当者識別子で、既存 `担当者` は表示互換用の投影である。
- 既存行で `担当者PersonID` が空の場合は `assignee_person_id: null` と
  `normalization_warnings: ["assignee_unresolved"]` を返す。文字列一致で補完しない。
- 正規化APIが作る行には版、発生元参照、冪等キーとfingerprint、期限日時、待ち情報、完了日時を保存する。
- actorは認証guardが確認したGraph person ID、service credential ID、allowlist済みinternal IDから`{ type, id }`へ正規化する。固定key順canonical JSONのpaddingなしbase64url `v1.<payload>`だけをactor namespaceに使い、body actor、表示名、raw session、区切り文字連結を使わない。同じGraph personはbearer/session間で同じnamespaceへ収束する。
- 外部APIのclient keyは`api:<actorNamespace>:`、Workflow候補は`workflow:<output>:`の保存namespaceへserver側で変換し、相互衝突を防ぐ。
- `config/canonical-task-store.json` を正本identity manifestとし、canonical JSONのSHA-256をBrainbase、MCP、migrationが起動時に検証する。`createCanonicalTaskStoreConfig()` はmanifestを一度だけ読み、同じimmutable objectをAPI repository、旧route guard、Mana、migration policyへ注入する。base/tableの個別環境overrideは禁止し、manifest欠落、hash不一致、table/column解決不能はmutationをfail-closedにする。

## API構成

- `GET /api/companion/tasks`
- `GET /api/companion/tasks/:taskId`
- `POST /api/companion/tasks`
- `PATCH /api/companion/tasks/:taskId`
- `POST /api/companion/tasks/:taskId/transitions`
- `DELETE /api/companion/tasks/:taskId`

既存 `createCompanionRouter` の認証・owner guardにTask固有guardを重ねる。Task APIで許可するのは
internal、service token、bearerだけで、CSRF免除のCompanion routeではcookie-onlyを許可せず、既存互換の
insecure-headerも拒否する。owner credentialはserver-sideで
configured ownerへscopeし、別person filter/assignmentを403にする。service/internal credentialは
固定store内でGraph確認済みpersonを扱えるが、store/projectは変更できない。typed principal、namespace、auth sourceを監査する。

ownerの作成で担当者が省略された場合はconfigured ownerを補完する。一覧と単体取得はowner担当Taskだけを
返し、未担当・別person Taskは存在を開示せず404にする。ownerからの担当解除・別person指定は403である。
service/internalだけが固定store内の未担当TaskとGraph確認済みの別person Taskを扱える。

既存ブラウザTask画面はbearer利用時だけCanonical一覧を取得し、opaque ID/versionを正本行identityとして保持する。
旧NocoDB一覧は非正本baseだけを表示し、manifestと一致するbase/table行はCanonical一覧との結合前に除外する。
Canonical一覧失敗時に旧正本行へfallbackしない。cookie-only sessionでは正本controlsを無効化してbearer再認証を
要求する。正本projectの担当者入力はPeople selectorとし、自由入力表示名を送らない。

Mana captureはbrowser sessionとCSRFを検証し、bodyのactor/ownerを信用せずsessionからGraph person principalを導出したinternal commandへ
変換する。clientは操作ごとにcapture UUIDを生成し、応答確定まで同じIDを再送する。同文の新規操作は新IDを使う。
保存keyは`mana:<actorNamespace>:<capture_id>`とする。configured owner以外のactorはPersonal KG境界でoperation検索前に拒否し、同じcapture IDでもownerのoperation結果を参照・再生しない。

## データフローと脅威境界

```mermaid
flowchart LR
  Mac["Mac Companion"] -->|"Bearer / fixed Task contract"| Guard["Companion auth and Task owner guard"]
  Mac -->|"resolve human step"| WorkflowAuth["Workflow auth and human-step authority"]
  Workflow["Workflow resolve routes"] --> WorkflowAuth
  Guard --> Service["CanonicalTaskService"]
  WorkflowAuth -->|"actor-preserving internal Task command"| Service
  Service -->|"assert persistent readiness"| Ready["Canonical mutation readiness"]
  Service -->|"verify person_id"| Graph["Graph People SSOT"]
  Service -->|"claim writer and operation"| PG["Postgres coordination and recovery checkpoints"]
  Service -->|"read or write canonical Task"| Noco["Fixed NocoDB Task table SSOT"]
  Service --> Audit["Brainbase audit log"]
  PG -->|"reconcile task_store target state"| JSON["Workflow JSON compatibility projection"]
  Noco --> Service
  Graph --> Service
  Service --> Mac
  Service --> Workflow
```

| 脅威 | 境界と対策 |
|---|---|
| clientが別storeを指定する | base/table/projectをrequestから受けず、署名付きopaque IDも固定storeへ照合する |
| ownerが他人または未担当Taskを列挙する | server-side owner filter、単体取得の404非開示、担当変更の403 |
| 自由入力名を人物権限に使う | Graphの`person_id`だけを権威値とし、表示名は投影に限定する |
| 同じ作成・承認が再送される | Postgres operation uniqueとNocoDB冪等キーDB一意制約で同じTask IDへ収束する |
| 旧route/scriptが正本へ直接書く | 旧NocoDB routeは正本base mutationを409で拒否し、固定tableへ書く運用scriptは認証済みCanonical Task APIへ移行する |
| Manaが正本へ直接書き障害をlocal成功へ変換する | captureはserviceへpending Taskを冪等作成し、source refsへ元type/project/contentを残す。read/write障害は503にする |
| ブラウザTask画面が拒否済み旧routeへ書く | repositoryが正本baseだけCanonical APIへ振り分け、版付きcreate/update/transition/deleteを使う |
| NocoDB MCPがcredentialで正本を迂回する | manifest identityへtable名/IDを解決し、record mutationと正本列metadata mutationを拒否する。解決不能時は全mutationを停止する |
| cookieやinsecure-headerがownerへ昇格する | Task固有guardがstore到達前に拒否し、bearerだけをowner credentialとして扱う |
| processごとに正本store設定がずれる | commit済みmanifestのcanonical JSON hashをBrainbase/MCP/migrationで比較し、個別overrideや解決失敗をmutation readiness失敗にする |
| actor文字列の区切り・認証方式で冪等境界が衝突または分裂する | 権威IDをtyped canonical principalへ正規化し、固定JSONのbase64url namespaceを共通moduleで生成する |
| 再起動や手動操作で検証前にmutationが開く | process-local gateをclosedで起動し、Postgres readiness rowとcurrent HEAD証跡、manifest/schema/writerを再検証した場合だけ開く。全mutation入口で同じassertを行う |
| 既存文字列候補または並べ替えで候補権限が変わる | 文字列をowner未解決objectへ正規化し、内容hashと同一内容ordinalから並び順に依存しないcandidate ID集合を投影する |
| 旧UIがwaiting/urgentを別値へ縮退する | adapterで待ち/緊急を双方向投影し、未知値は保持して明示する |
| 旧writerの遅延PATCHが新writerを上書きする | 単一writer tokenを自動takeoverせず、旧process停止確認後の明示回復だけを許可する |
| Task作成後にWorkflow JSON更新が失われる | Task IDとhuman step/run目標状態、監査checkpoint、phaseをPostgresから再投影する |
| 下流障害を0件と誤認する | Graph/NocoDB/Postgres障害は構造化503にし、空・partialへ変換しない |

## 一度だけ作成

1. `resolveHumanStep` がapproved要求と `write_back_target=task_store` を検出する。
2. approval inbox投影時に文字列をowner未解決objectへ正規化し、IDなし候補へ内容hash由来の安定`candidate_id`集合を付与する。Macの`response_ref.review_items`を同じIDで一対一に結合する。
3. `decision_mode`と`resolution`の対応を検証する。承認itemの`edited_fields`にある許可値だけを元候補へ上書きしてGraphで再確認する。拒否itemは除外結果へ残し、修正依頼または最終owner未解決があれば理由付き409でpendingに残す。
4. `workflow:<outputId>:<candidateFingerprint>:<ordinal>` を直接APIと分離した、並べ替えに安定な保存冪等キーとして全候補を作成する。
5. 1件ごとにTask IDをPostgres operation resultへcheckpointし、human step metadataへ互換投影する。全件成功後にphaseを進めてapprovedへ遷移する。
6. 応答はトップレベル `materialized_task_ids` と詳細materializationを返す。
7. 再要求でstepがapprovedなら保存済みまたは冪等keyから復元した同じ結果を返す。

NocoDB作成後にプロセスが停止しても、再試行は冪等キーで既存行を取得する。Task作成に
失敗した場合はhuman stepをpendingのまま残す。Workflow ledgerのtransactionは外部NocoDBを
巻き戻せないため、補償ではなく冪等な前進回復を採用する。

## 単一writerと永続調停

NocoDB REST PATCHはPostgres lease generationを条件にした原子的更新を提供しないため、v1は
ADR-016に従いTask mutationと`task_store`承認を単一writer processへ限定する。Postgres
`canonical_task_writer` singleton rowにactive process tokenを保存し、他processは503にする。
graceful shutdown時だけreleaseし、異常終了後は旧process停止確認を伴う明示回復までtakeoverしない。

writer tokenは必要条件だがmutation解禁の十分条件ではない。`canonical_task_readiness` singleton rowへ
manifest hash、schema version、writer token、current HEAD、必須回帰artifact hashを保存する。各processは
local gateをclosedで起動し、writer claim/reconcile後に保存rowと現在値を再照合できた場合だけ開く。
`CanonicalTaskService`のcreate/update/transition/delete、Mana internal command、`task_store` materializationは
同じ`assertMutationReady()`をservice入口で強制する。欠落・不一致・DB障害はreadを維持して503にする。

before-enable preflightは認証、approval inbox、両resolve route、非Task承認、legacy route/UI、Mana、browser、
MCP、delete回復、4 script、migration、Mac wire fixtureの証跡file hashをcurrent HEADへ束ねる。明示enable commandは
artifactと現在値をtransaction内で再検証し、全条件成立時だけrowをreadyへupsertする。失敗時はclosed stateを
変更しない。restart時は保存readyを無条件に信用せず再照合し、rollbackは最初に明示disableする。

`server.js`はHTTP listen前にclaimとreconcileを実行し、`registerGracefulShutdown`はHTTP close後にreleaseする。
明示回復は`recover-canonical-task-writer.js --expected-token`だけから行う。再投影監査はoperation/phase由来の
決定的IDを`upsertAuditLog`し、既存非Task workflowのappend-only `writeAuditLog`は変えない。

Postgres `canonical_task_operations` を実行調停台帳として使い、`(scope, operation_key)` のunique制約、
writer token、fingerprint、result JSON、human step/run目標状態、監査checkpoint、後処理phaseを保存する。
Task本文や状態は保存しないため、Taskの正本はNocoDBのままである。createの最終防衛はNocoDB正本表の
`冪等キー` DB一意制約が担う。

単一writerは新APIだけの宣言では成立しないため、既存writerも境界へ含める。旧`/api/nocodb/tasks`は
一覧読取と正本base以外のmutationを維持するが、正本baseへのcreate/update/deleteはtable lookup前に
`canonical_task_api_required`で拒否する。正本tableへ直接fetchする運用scriptはCanonical Task API clientへ
移行し、静的policy testで固定table IDを使うwrite pathの再導入を防ぐ。

Mana `/capture` は`mana_capture`のsource refを持つ`pending` TaskとしてCanonicalTaskServiceへ作成する。
元の`type`と`project`はsource metadataで互換保持し、自由入力`assignee`は受理せず`assignee_person_id`だけを
Graph確認する。`/captures`は同じsource refで正本Taskを絞って従来形へ投影し、障害を空一覧へ変換しない。

ブラウザのNocoDB Task repositoryは各Taskのbaseを判定し、正本baseのmutationだけCanonical APIへ送る。
deleteも`expected_version`と冪等keyを持つoperationとして単一writer内で実行し、削除済み再送はoperation結果を
再生する。正本base以外は旧NocoDB APIを維持する。NocoDB MCPは正本baseかつTask tableのcreate/update/deleteを
client呼出前に`canonical_task_api_required`で拒否し、readと他base/tableのmutationは変えない。

deleteは二つの永続claimを使う。`task-version:<taskId>:<expectedVersion>`はupdate/transition/deleteを相互排他し、
`task-delete:<actorNamespace>:<clientKey>`はclient再送を識別する。後者へfingerprint、削除前のactor/auth source、owner認可、
Task ID/version snapshot、`prepared` stateを保存してからNocoDBを削除する。削除後・result保存前に停止した場合、旧writer停止と
prepared intent、固定storeでの行不存在を照合して同じ削除結果を確定する。削除後の再送認可は保存済みsnapshotに限定する。
同一actor namespaceの同key異fingerprintは409、別key同versionは409とし、別actor namespaceにはoperationを検索・再生せず404を返す。

- createはidempotency key、update/transitionは共通scopeの`taskId:expectedVersion`、承認はstep IDをclaimする。
- claim取得後に現行Task版を再読込し、一致時だけNocoDBへ書く。変更patchには次版、最終操作key、fingerprintを含める。
- writer停止時は自動引継ぎを行わない。旧process停止を運用確認した明示回復でtokenを移譲し、保存済みoperationから再開する。
- createはNocoDB uniqueで同じ行へ収束し、mutationはexpected versionと同じ操作markerを同じrowへ書く。異なるfingerprintはoperation claim時に409となる。
- Postgres台帳が利用不能なら503にし、process内Mapだけで正しさを代替しない。

これにより同一processの並行POST、同一版更新、同一step承認を制御し、複数processの同時writeを拒否する。

## 前進回復

| 停止点 | 回復 |
|---|---|
| 一部Task作成後 | deterministic keyで既存Taskを回収し、残りを続行 |
| create成功後・checkpoint前 | operation結果またはNocoDB unique key照会からIDを復元 |
| 全ID保存後・approved前 | 外部createをせずapprovedへ進む |
| approved後・audit/run更新前 | Postgresの目標状態とcheckpointをWorkflow JSONへ再投影し、未完了の後処理だけ再実行 |
| approvedだがIDなし | 全keyから復元できる場合だけmetadata修復。不足時は409で手動確認 |
| 同時approve | 単一writer内のstep claimとdestination uniqueで同一結果へ収束し、他方は同じ完了結果を読む |
| writer異常終了 | 自動takeoverせず503を維持。旧process停止確認後の明示回復でoperationを再開 |
| delete prepared後・NocoDB削除前 | 保存済み認可/fingerprintを照合し、行が現存すれば同じwriter operationで削除を続行 |
| NocoDB削除後・delete result保存前 | prepared intentと行不存在を照合し、保存済みsnapshotから同じ成功resultとauditを確定 |

## 選択肢と決定理由

- NocoDBだけのlookup-then-createは並行要求を原子的に止められないため棄却した。
- operation leaseと自動takeoverの案は、leaseを失ったworkerの遅延NocoDB書き込みをfenceできないため棄却した。
- process内mutexは再起動・複数processを跨げないため補助最適化に限定した。
- TaskをPostgresへ複製する案はSSOTを増やすため棄却した。
- Task本文を持たない単一writer tokenとoperation ledgerは既存NocoDB正本を保ちつつ、現行単一process運用で並行実行と回復を閉じられるため採用した。

運用責任はBrainbase serverが持つ。release前にPostgres schema、writer token、NocoDB列と冪等キー一意制約、固定storeをcheckし、
不足時はTask書き込み経路を停止する。障害復旧はoperation状態とNocoDB idempotency keyを照合して前進する。

初回releaseは`docs/runbooks/canonical-task-cutover.md`が所有する。`npm run preflight:canonical-task-cutover -- --phase before-migration`で旧Brainbase、Mana、MCP、運用scriptを先に停止・排水し、直接writerが0であることを確認する。その後に
Postgres writer/operation schema、NocoDB列/uniqueを適用し、guardを含む新Brainbase/MCPを起動する。manifest hash、
writer claimと全必須回帰を`--phase before-enable --evidence-out <artifact>`でcurrent HEADへ束ね、`canonical-task:readiness -- --enable --evidence <artifact>`がatomicに成功した後だけmutationを解禁し、実契約確認、Macの順で反映する。
両migrationは`--apply`と`--check`を提供し、NocoDB metadata APIでDB一意制約を保証できない環境は
fail-closedにして、基盤DB側の管理migrationを別途完了させる。
rollbackは最初にreadinessを明示disableし、`--phase rollback`でschema、manifest、legacy/Mana/MCP guardの維持と旧直接writer非復活を確認する。API受付を停止してforward fixする。

## 障害方針

- NocoDB未設定・通信失敗: `503 task_store_unavailable`
- Graph未確認・通信失敗: `503 assignee_directory_unavailable`
- person不存在: `422 invalid_assignee_person_id`
- 版不一致: `409 version_conflict` とcurrent Task
- 冪等キー再利用の内容不一致: `409 idempotency_conflict`
- mutation readiness不成立: `503 canonical_task_mutation_not_ready`

空配列、自由入力への退避、承認だけ先に進める処理は行わない。
