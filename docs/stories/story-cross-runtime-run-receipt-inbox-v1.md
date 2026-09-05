---
story_id: story-cross-runtime-run-receipt-inbox-v1
title: Cross-runtime run receipt common control plane v1
status: completed
created_at: 2026-07-15
updated_at: 2026-07-16
horizon: quarter
view: business
period: 2026Q3
architecture_docs:
  - docs/architecture/ADR-016-run-receipt-control-plane-boundary.md
  - docs/architecture/ADR-017-agent-first-product-surface.md
  - docs/architecture/brainbase-surface-responsibility-matrix.md
  - docs/architecture/story-cross-runtime-run-receipt-inbox-v1.md
  - docs/runbooks/run-receipt-inbox-v1.md
spec_docs:
  - docs/specs/cross-runtime-run-receipt-inbox-v1.md
---

# Cross-runtime run receipt common control plane v1

## 背景

Mana、Codex Automations、GitHub Actions、SalesTailorでは自動実行が増えているが、成否・停止理由・証跡の見え方がランタイムごとに分断されている。そのため、実行されていない状態を「0件」、証拠未取得を「成功」と誤認しやすく、人間が確認すべきrunを横断して発見できない。

BrainbaseにはWorkflow Mission Controlのrun台帳があり、Cloudflare/computer向けには詳細な `external_runner.v0` がある。4ソースの運用結果を集約するためにCloudflare/computer専用契約を流用すると、Role Agent、round、learning candidateなど不要な責務まで各connectorへ強制してしまう。

## User Story

Brainbase operatorとして、異なるruntimeの最終実行結果を同じAgent Run Inboxで確認したい。なぜなら、失敗、blocked、人間待ち、未確認、no dataをゼロ件や成功から区別し、次に人間が介入すべきrunへ優先順で到達したいから。

## Business Outcome

- 対象ユーザー: 複数runtimeの自動実行を監督するBrainbase operator。
- 課題: sourceごとの画面やログを巡回しないと、停止中のrunと証拠未取得runを区別できない。
- 成功状態: 4ソース共通のreceiptを検証・冪等保存でき、届いた最終runを1つのInboxで優先順に確認し、blocked、failed、waiting human、unconfirmed、no dataへ到達できる。
- 主要KPI: 共通契約へ到達した要介入runの100%がAgent Run Inboxの上位に現れ、receiptが既存Operational Inboxへ重複表示されない。
- 運用指標: `blocked|failed|waiting_human` のreceiptについて、actionまたはblocker理由の欠落を0件に保つ。
- 優先度: source固有connectorの前提となる共通契約・台帳・operator surfaceなので最優先。

## Acceptance Criteria

- [x] ac:1 `run_receipt.v1` はsource、project、workflow、external run identity、run status、evidence stateを必須検証し、不正なreceiptを保存前に拒否する。
- [x] ac:2 同じ `project_id + source.type + external_run_id` の再送は既存runを返すduplicateとなり、別projectまたは別sourceの同じexternal run idは別runとして保存される。
- [x] ac:3 receiptはWorkflow Mission Controlのworkflow runへ投影され、sourceの `run_status` と `evidence_state` を失わない。
- [x] ac:4 `success`、`failed`、`blocked`、`waiting_human`、`cancelled` を区別し、`unconfirmed` と `no_data` を成功または0件へ潰さない。
- [x] ac:5 Workflow Mission ControlのAgent Run Inbox画面はreceiptのsource status、evidence state、action、blocker、evidence referenceを表示し、source/project/status/evidence stateで絞り込める。APIと画面は同じ決定的な優先順位を使う。filterはlabel付きでkeyboard操作でき、focusを可視化し、loading/unavailable warningは名前付きstatus regionで通知し、badgeの意味を色だけに依存させない。
- [x] ac:6 raw logや顧客本文は複製せず、証跡はsource-owned URLまたはartifact referenceとして保存する。
- [x] ac:7 ingest認証は本番で `internal` または `service-token` のserver-to-server credentialを要求し、通常のhuman JWTはAuthorization Bearerでもcookieでも拒否する。認証主体がアクセスできないprojectへのreceiptも拒否する。`insecure-header` は既存middlewareが明示許可するtest/developmentだけに限定する。
- [x] ac:8 receipt deliveryの成否とsource runの成否を別フィールドとして扱い、delivery成功をrun成功と解釈しない。
- [x] ac:9 同一identityの同時ingestはreceipt lockで直列化し、1件だけをcreate、残りをduplicateとして返す。lock取得不能時は部分保存せず明示的に失敗する。
- [x] ac:10 production CSRF middlewareは `POST /api/run-receipts/ingest` だけをbrowser CSRF対象外にし、route側でserver-to-server credentialを必須化する。cookie/session-only POSTは拒否し、既存exemptionは変えない。
- [x] ac:11 receipt workflowは共有WMC台帳へ保存しても既存Operational Inboxと汎用workflow/run APIの一覧・詳細・更新・実行・再実行から除外し、Agent Run Inboxだけに1回表示する。receipt＋非receipt混在時も非receiptの既存priorityは変えない。
- [x] ac:12 `GET /api/run-receipts/inbox` のtimeout、network error、または5xx時はMCPで取得不能を明示し、Mac Companionは前回成功snapshotを維持する。障害を空配列や0件成功へ丸めない。
- [x] ac:13 Agent Run Inboxは `(project_id, source.type, source.workflow_id)` ごとに最新receipt runだけを表示する。古いblocked/failed履歴は台帳に保持するが、後続の新しいrunがある場合はInboxへ残さない。最新run選択後にfilter、priority、count、limitを適用する。
- [x] ac:14 Inboxの全件順序はpriority、UTC instantへ正規化したeffective timestamp、persisted `created_at`、決定的run idでtotal orderにし、同値時もlimit/pagination結果を安定させる。全件・filter・history・diagnosisはRun Receipt専用serviceとMCP、要介入projectionはMac Companionが担い、Brainbase Web UIへ状態を複製しない。
- [x] ac:15 JSON台帳への異なるreceipt identityの同時ingest、receiptと既存writerの競合、失敗transactionのrollbackをrepository-wide write transactionで直列化し、どのwriterのworkflow/run/step/auditも失わない。receipt identity lockを先に、shared-ledger transaction lockを後に取得する順序を固定する。同じasync transaction ownerによるnested transactionは外側へjoinしてqueue/file leaseを再取得せず、外側だけがcommit/rollbackする。JsonFile本番のshared-ledger collection mutatorはtransaction外writeを拒否する。identity lock/lease metadataは台帳外の別control-plane stateとして同期し、lock操作は台帳reloadを行わない。startup seedは同じlease/ownerの初期化transaction、specialized automation services、WorkflowRunner、external_runnerを含む全production writerは短いtransaction境界、Candidate Store等の外部I/Oはlease外へ移す。external_runner candidateはcontract/workspace/org/project/runner/run/source candidateからglobal idを派生し、project/run scope markerと元source candidate idを `source_event_ids` に残す。Candidate Repositoryは同一primary idをdedupe keyに関係なく上書き前に拒否する。store済み未確定の再試行はfindById同値時だけ採用、相違時はactionable conflict、pending再開ではduplicate auditなし、全収束後だけ既存duplicate auditを維持する。

## Verification Evidence

- Unit / integration: run receipt contract、ingest、shared ledger transaction、Inbox API、UI client/service/viewを含むfocused regressionが全件pass。
- Browser E2E: tracked Playwrightで実server-to-server ingest、実Inbox API、latest-run collapse、priority、filter、failure boundary、既存の非receipt Operational Inbox itemの維持をcurrent HEADで確認。
- Failure semantics: API 503時も既存receipt snapshotを保持し、取得不能を0件へ丸めないことを確認。

## 受け入れシナリオ

### S-001: success receiptを投影する

- Given: sourceがsuccessとconfirmed、unconfirmed、またはno_dataを報告する
- When: BrainbaseがreceiptをWorkflow Mission Controlへ投影する
- Then: runをsuccessとして保持し、sourceが非`none` actionを明示した場合はそのactionを使い、明示しない場合だけ`none`をadapter defaultとして使う。unconfirmedまたはno_dataならoperator review対象として可視化する

### S-002: failed receiptを投影する

- Given: sourceがfailedと根拠状態を報告する
- When: Brainbaseがreceiptを投影する
- Then: failed、needs_actionへ写像し、sourceが非`none` actionを明示した場合はそのactionを使い、明示しない場合だけ`check_error`をadapter defaultとして使う。根拠状態を失わない

### S-003: blocked receiptを最優先する

- Given: sourceがblockedとblockerまたはactionを報告する
- When: Agent Run Inboxがpriorityを計算する
- Then: needs_actionへ写像し、sourceが非`none` actionを明示した場合はそのactionを使い、明示しない場合だけ`resolve_blocker`をadapter defaultとして使う。通常のfailed runより上位に置く

### S-004: waiting_human receiptを投影する

- Given: sourceがwaiting_humanを報告する
- When: Brainbaseがreceiptを投影する
- Then: waiting_human、openへ写像し、sourceが非`none` actionを明示した場合はそのactionを使い、明示しない場合だけ`review_run`をadapter defaultとして使う。人間判断待ちを保持する

### S-005: cancelledをsuccessへ変換しない

- Given: sourceがcancelledを報告する
- When: Brainbaseがreceiptを投影する
- Then: cancelled、closedとして保持し、sourceが非`none` actionを明示した場合はそのactionを使い、明示しない場合だけ`none`をadapter defaultとして使う。success件数へ含めない

### S-006: 同一identityを冪等再送する

- Given: 同じproject、source、external run identityのreceiptが再送または同時送信される
- When: normalized contentが同一またはdelivery metadataだけが異なる
- Then: 1件だけをcreateし、残りをduplicateとして返す

### S-007: 同一identityの内容衝突を拒否する

- Given: 同じidentityでnormalized contentが異なるreceiptが届く
- When: ingestがidempotencyを検証する
- Then: ledgerを変更せずidentity conflictとして拒否する

### S-008: 検証失敗をatomicに拒否する

- Given: schema、auth、project access、raw-content、またはevidence validationが失敗する
- When: ingestを試行する
- Then: workflow、run、step、auditを部分保存せず拒否する

### S-009: filter変更失敗時に確認済みsnapshotを守る

- Given: 確認済みfilterとAgent Run Inbox snapshotが表示されている
- When: 次のfilter requestがtimeoutまたは5xxになる
- Then: 確認済みitemとfilterを保持し、取得不能を表示し、Operational Inboxを利用可能に保つ

### S-010: filterをlatest receiptへ合成する

- Given: source、project、run status、evidence stateのfilterが指定される
- When: Inboxを投影する
- Then: workflow identityごとの最新receiptだけへfilterを合成し、取得不能を0件として扱わない

### S-011: 認証境界を狭く保つ

- Given: ingestまたはlistingへの認証、CSRF、project authorizationが不正である
- When: APIへアクセスする
- Then: 既存exemptionを広げず、他projectを開示せず、書込前に拒否する
- 通常メンバーのInbox検証では、組織・取得済みproject catalog・project grantをそろえる。5 sourceの保存結果が権限内にだけ表示され、組織またはgrantがない場合は表示されないことを実際の認可policyで確認する。

### S-012: external runner candidate outboxを回復する

- Given: external_runner.v0 candidate deliveryがpendingで中断している
- When: 同じrunをreplayする
- Then: exact stored candidateは冪等再開し、mismatchはactionable conflict、収束後のduplicate audit互換を維持する

### S-013: source identity不明をconnector observationにする

- Given: connectorがsource-owned run identityを取得できない
- When: connector自身の観測試行を報告する
- Then: connector observationとして可視化し、source failureや空successを捏造しない

### S-014: operator surfaceをaccessibility込みで表示する

- Given: operatorがWorkflow Mission Controlを利用する
- When: receiptを読み込みまたはfilterする
- Then: status、uncertainty、action、evidence ref、label、keyboard focus、status warningをAPI順序と一致させる

### S-015: legacy workflow surfaceからreceiptを隔離する

- Given: receiptとnon-receipt workflowが共有ledgerに存在する
- When: legacy workflow、run、rerun、Operational Inbox routeを使う
- Then: receiptはAgent Run Inboxだけに現れ、non-receiptのmembershipとpriorityを変えない

### S-016: Inbox取得不能を局所化する

- Given: receipt Inbox requestがtimeout、network error、または5xxになる
- When: failureをUIへ投影する
- Then: Agent Run Inboxだけをunavailableにし、確認済みsnapshot、Workflow page、Operational Inboxを維持する

### S-017: 最新runをfilterより先に選ぶ

- Given: 同じsource workflow identityに複数receipt runがある
- When: Inboxを投影する
- Then: filter、count、priority、limitより先に最新runを選び、古いfailureを復活させない

### S-018: total orderを決定的にする

- Given: receiptのpriorityまたはoffset違いのUTC instantが同値である
- When: orderingとlimitを繰り返す
- Then: epoch、persisted created_at、deterministic run idのtie-breakで同じitemsを返す

### S-019: UI stateを専用serviceから更新する

- Given: browserがAgent Run Inboxを読み込む
- When: API取得が成功または失敗する
- Then: 専用clientとDI serviceがReactive StoreとEventBusを更新し、legacy workflow stateを直接変更しない

### S-020: shared ledger writerを直列化する

- Given: receiptとlegacy writerが同じJSON ledgerへ同時に書き込む
- When: commit、failure、seed、nested transaction、candidate outbox recoveryが重なる
- Then: deadlockやrollback overwriteを起こさず、全commit済みworkflow、run、step、auditを保持する

## Workflow State Scenarios

- S-001 `workflow state transition`: validated success receiptをsource statusを変えずclosedへ投影し、明示source actionを優先し、不確実なevidenceはreview対象に残す。
- S-002 `workflow state transition`: failed receiptをneeds_actionへ投影し、明示source actionを優先し、なければ`check_error`を使い、evidence lifecycleを維持する。
- S-003 `workflow state transition`: blocked receiptの明示source actionを優先し、なければ`resolve_blocker`を使って最優先itemへ投影する。
- S-004 `workflow state transition`: waiting_human receiptの明示source actionを優先し、なければ`review_run`を使ってopenへ投影する。
- S-005 `workflow state transition`: cancelled receiptの明示source actionを優先し、なければ`none`を使ってclosedへ投影し、successへ変換しない。
- S-006 `workflow retry transition`: 同一receiptの再送はcreate済みrunをduplicateとして返す。
- S-007 `workflow rollback transition`: 同一identityの内容衝突はledger mutation前に拒否する。
- S-008 `workflow rollback transition`: schemaまたはauthorization failureは全collectionをwrite-freeに保つ。
- S-009 `workflow retry transition`: filter request失敗時は最後のconfirmed snapshotとfiltersへ戻す。
- S-010 `workflow state transition`: latest selection後にfilter、priority、count、limitを適用する。
- S-011 `workflow auth boundary transition`: server-to-server credentialとproject scopeを通過したrequestだけを処理する。
- S-012 `workflow retry transition`: pending candidate intentをexact match時だけ再開し、conflictはpendingで止める。
- S-013 `workflow state transition`: source identity不明の試行をconnector observationへ投影する。
- S-014 `workflow state transition`: APIのorderとuncertaintyをaccessible UIへ損失なく投影する。
- S-015 `workflow compatibility transition`: receiptをlegacy workflow surfaceから除外しAgent Run Inboxだけへ載せる。
- S-016 `workflow rollback transition`: Inbox failureをreceipt sectionへ局所化しconfirmed stateへ戻す。
- S-017 `workflow state transition`: workflow identity単位でlatest runへcollapseしてからfilterする。
- S-018 `workflow state transition`: UTC epochと永続化tie-breakによるtotal orderを返す。
- S-019 `workflow state transition`: receipt専用serviceがStore更新とloadedまたはfailed eventを発火する。
- S-020 `workflow rollback transition`: shared-ledger transactionはouter ownerだけがcommitまたはrollbackする。

## Scenario Clauses

- SCN-001: S-001のsuccess projectionでevidence uncertaintyをreview対象として保持する。
- SCN-002: S-002のfailed projectionでerrorとevidence stateを保持する。
- SCN-003: S-003のblocked projectionをfailedより高いpriorityにする。
- SCN-004: S-004のwaiting_human projectionを人間判断待ちとして保持する。
- SCN-005: S-005のcancelled projectionをsuccessへ数えない。
- SCN-006: S-006のidempotent replayとconcurrent deliveryでexactly one createを保証する。
- SCN-007: S-007のidentity conflictでwrite-free rejectionを保証する。
- SCN-008: S-008のschema、auth、evidence failureでatomic rollbackを保証する。
- SCN-009: S-009のfailed filter transitionでconfirmed snapshotとfiltersを保持する。
- SCN-010: S-010のcomposed filterをlatest collapse後に適用する。
- SCN-011: S-011のauth、CSRF、project access boundaryを狭く保つ。
- SCN-012: S-012のcandidate outbox replayでexact adoptionとconflictを区別する。
- SCN-013: S-013のsource identity unavailableをconnector observationとして保持する。
- SCN-014: S-014のAPI order、keyboard focus、status regionをUIへ保持する。
- SCN-015: S-015のlegacy isolationでreceiptをexactly once表示する。
- SCN-016: S-016のtimeout、network、5xx failureをreceipt sectionへ局所化する。
- SCN-017: S-017のlatest selectionをfilter、count、limitより先に行う。
- SCN-018: S-018のepochとdeterministic idで安定したpaginationを保証する。
- SCN-019: S-019のclient、service、Store、EventBus境界を維持する。
- SCN-020: S-020のconcurrent writer、nested rollback、seed recoveryで全commit済みdataを保持する。

## Failure Modes

- FM-001 `schema_failure`: 未定義status/evidence state、空のidentity、壊れたevidence refは400で拒否する。
- FM-002 `parse_failure`: source label、summary、blocker、action、metric、evidence label/refに改行・制御文字・上限超過・禁止keyがある場合は400で拒否する。connectorは送信前に顧客本文・secret・raw logを除去する。
- FM-003 `auth_denied`: cookieだけのbrowser requestやproject非許可credentialは403で拒否する。
- FM-004 `source_unavailable`: connectorがsourceへ接続できずsource run identityも得られない場合は、connector自身の観測試行を `observation_kind=connector_observation`、synthetic external run identity、`blocked + no_data|unconfirmed` として表現する。source runを失敗扱いに偽装しない。
- FM-005 `delivery_failure retry_or_async_failure`: connector側outbox/retryで扱い、Brainbaseに届いたreceiptのsource run statusを書き換えない。
- FM-006 `receipt_inbox_failure evidence_lifecycle_regression`: receipt一覧APIの取得失敗はAgent Run Inboxだけにwarningを表示し、既存workflow一覧の取得・描画を巻き込まない。取得不能を0件と表示しない。
- FM-007 `stale_receipt_history`: 同一source workflowの古いblocked/failed runは履歴として台帳に残すが、新しいrunより上位のInbox itemとして再表示しない。
- FM-008 `shared_ledger_race`: receipt identityが異なっても共有JSON台帳は同じため、repository-wide transaction lockなしで全体ファイルをrenameしない。失敗transactionはdiskへrollback snapshotを書き戻さず、lock取得時点のdisk stateを維持する。
- FM-009 `receipt_identity_lock_timeout retry_or_async_failure`: `workspace_id=run_receipt:<project_id>` と決定的run idのlockをbounded retryで取得できない場合は、書込前に停止し、`Retry-After` 付きHTTP 503として再試行可能性を明示する。payload不正やidentity conflictの400とは分離する。
- FM-010 `nested_transaction_deadlock`: 同一async contextのnested transactionをin-process queueの後ろへ再投入しない。inner callbackは外側transactionへjoinし、inner failureはtransactionをrollback-onlyにして、呼び出し側が例外をcatchしても外側commitを拒否する。
- FM-011 `unserialized_writer`: JsonFile repositoryのshared-ledger collection mutation primitiveはactive transaction contextなしでは `workflow_repository_transaction_required` としてwrite前に拒否する。identity lock/lease metadataは台帳外で同期し、lock操作で台帳をreloadしない。runtime serviceはremote handler、network、Candidate Store、長時間sleepをfile lease内でawaitせず、各永続化まとまりだけを短いtransactionへ入れる。
- FM-012 `bootstrap_seed_race`: seed workflowはrepository公開前に同じfile leaseとtransaction ownerで初期化し、既存台帳をreload後に不足分だけ追加する。constructorから通常mutatorをguard外呼び出ししない。
- FM-013 `candidate_outbox_interruption retry_or_async_failure`: external_runnerのcandidate intentを台帳へ先にcommitし、実行スコープから派生したglobal candidate idでlease外保存後に結果を短いtransactionで確定する。store済み未確定のexact replayはfindByIdでimmutable projectionが一致する場合だけ採用し、相違はpending/actionable conflictとして拒否する。pending再開はduplicate auditを書かず、全intent収束後の次回duplicateだけ既存 `external_runner.duplicate_replay_ignored` auditを短いtransactionで書く。

## 非目標

- 4ソース固有のAPI接続・schedule・outbox実装と、本番runを使ったsource別canaryは後続の各connector Storyで扱う。本Storyのcompletedは共通control-plane基盤の完成を意味し、4ソース本接続の完了を意味しない。
  - `story-mana-run-receipt-connector-v1`: `implemented_locally`。`docs/connectors/run-receipt/story-mana-run-receipt-connector-v1.md`（実装正本: `projects/mana@ddd49d23c8e61400403cbc8b19ce008025065ee2:docs/specs/story-mana-run-receipt-connector-v1.md`、branch: `codex/mana-run-receipt-connector`）
  - `story-codex-automations-run-receipt-connector-v1`: `implemented_locally`。`docs/connectors/run-receipt/story-codex-automations-run-receipt-connector-v1.md`（owner: `code/brainbase`、実装artifact: `scripts/run-receipt/codex-automations-reporter.mjs`）
  - `story-github-actions-run-receipt-connector-v1`: `implemented_locally`。`docs/connectors/run-receipt/story-github-actions-run-receipt-connector-v1.md`（owner: `code/brainbase`、実装artifact: `.github/actions/run-receipt-reporter/action.yml`）
  - `story-salestailor-run-receipt-connector-v1`: `blocked_local_environment`。`docs/connectors/run-receipt/story-salestailor-run-receipt-connector-v1.md`（owner: `code/salestailor`、planned artifact: `src/services/run-receipt/run-receipt-outbox.ts`、安全な分離worktreeを作れず未実装・未確認）
- Cloudflare/computer向け `external_runner.v0` を置き換えない。
- raw logs、顧客返信、transcriptをBrainbaseへ複製しない。
- receiptからGraph SSOTへ自動学習・自動昇格しない。

## Operator Surface

- 正本はreceipt contract、共有run台帳、priority projection、`GET /api/run-receipts/inbox`とする。Workflow Mission Control内のAgent Run InboxはMCP/Companion移管中の互換面であり、恒久的な完成形としない。
- 全件・履歴・filter・診断・管理はCodex/Claude CodeからMCPで扱う。MCP parityが未実装または未確認の間はWebを`temporarily_keep`とし、移管済みと偽装しない。
- Mac Companionには`blocked`、`failed`、`waiting_human`、`unconfirmed`、`no_data`を中心とする要介入projectionを出す。通常のconfirmed successは既定の注意面へ常時表示しない。
- `no_data` と `unconfirmed` は成功色や0件表示へ混ぜず、warning badgeと根拠不足の説明を必ず表示する。
- `omitted_count` は現在のfilterには一致するが `limit` により返却されなかったreceipt数であり、source未確認数ではない。
- Agent Run Inboxはworkflow identityごとに最新runへ畳み込んだ後でfilterとpriorityを適用する。`count` は畳み込み後かつfilter一致後、limit適用前の件数であり、`has_more = count > items.length`、`omitted_count = count - items.length` とする。
- APIの並びはpriority昇順、effective timestampのUTC instant降順、persisted `created_at` のUTC instant降順、決定的run id辞書順降順とする。RFC 3339 offset表記を文字列比較せずepoch millisecondへ変換し、同じ集合とlimitに対して常に同じitemsを返す。
- 既存の非receipt workflow一覧・承認Inboxのpriorityは変更しない。receipt workflow/runは汎用workflow/run APIの一覧・詳細・更新・実行・再実行と既存Operational Inboxへ混入させず、receiptのpriorityと将来の操作はreceipt専用APIとUI sectionで一元化する。
- 移行中のreceipt Web UIは`public/modules/domain/run-receipt/`配下のclient/serviceでAPI取得とfailure normalizationを行う。MCP/Companion移管のcurrent-HEAD evidenceが揃うまで互換性を維持し、その後はWeb専用client/service/view/state/eventをretirement対象とする。
