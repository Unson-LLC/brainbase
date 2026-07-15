---
story_id: story-cross-runtime-run-receipt-inbox-v1
title: Cross-runtime run receipt inbox v1
status: active
created_at: 2026-07-15
updated_at: 2026-07-15
horizon: quarter
view: business
period: 2026Q3
architecture_docs:
  - docs/architecture/ADR-016-run-receipt-control-plane-boundary.md
  - docs/architecture/story-cross-runtime-run-receipt-inbox-v1.md
spec_docs:
  - docs/specs/cross-runtime-run-receipt-inbox-v1.md
related_stories:
  - story-mana-run-receipt-production-connector-v1
  - story-codex-automations-run-receipt-production-connector-v1
  - story-github-actions-run-receipt-production-connector-v1
  - story-salestailor-run-receipt-production-connector-v1
---

# Cross-runtime run receipt inbox v1

## 背景

Mana、Codex Automations、GitHub Actions、SalesTailorでは自動実行が増えているが、成否・停止理由・証跡の見え方がランタイムごとに分断されている。そのため、実行されていない状態を「0件」、証拠未取得を「成功」と誤認しやすく、人間が確認すべきrunを横断して発見できない。

BrainbaseにはWorkflow Mission Controlのrun台帳があり、Eve向けには詳細な `external_runner.v0` がある。4ソースの運用結果を集約するためにEve専用契約を流用すると、Role Agent、round、learning candidateなど不要な責務まで各connectorへ強制してしまう。

## User Story

Brainbase operatorとして、異なるruntimeの最終実行結果を同じAgent Run Inboxで確認したい。なぜなら、失敗、blocked、人間待ち、未確認、no dataをゼロ件や成功から区別し、次に人間が介入すべきrunへ優先順で到達したいから。

## Business Outcome

- 対象ユーザー: 複数runtimeの自動実行を監督するBrainbase operator。
- 課題: sourceごとの画面やログを巡回しないと、停止中のrunと証拠未取得runを区別できない。
- 成功状態: 4ソースの最終runを1つのInboxで優先順に確認し、blocked、failed、waiting human、unconfirmed、no dataへ到達できる。
- 主要KPI: sourceごとの手動巡回をせずに、要介入runの100%がAgent Run Inboxの上位に現れる。
- 運用指標: `blocked|failed|waiting_human` のreceiptについて、actionまたはblocker理由の欠落を0件に保つ。
- 優先度: 4 connector Storyの前提となる共通契約なので最優先。

## Acceptance Criteria

- [ ] ac:1 `run_receipt.v1` はsource、project、workflow、external run identity、run status、evidence stateを必須検証し、不正なreceiptを保存前に拒否する。
- [ ] ac:2 同じ `project_id + source.type + external_run_id` の再送は既存runを返すduplicateとなり、別projectまたは別sourceの同じexternal run idは別runとして保存される。
- [ ] ac:3 receiptはWorkflow Mission Controlのworkflow runへ投影され、sourceの `run_status` と `evidence_state` を失わない。
- [ ] ac:4 `success`、`failed`、`blocked`、`waiting_human`、`cancelled` を区別し、`unconfirmed` と `no_data` を成功または0件へ潰さない。
- [ ] ac:5 Workflow Mission ControlのAgent Run Inbox画面はreceiptのsource status、evidence state、action、blocker、evidence referenceを表示し、source/project/status/evidence stateで絞り込める。APIと画面は同じ決定的な優先順位を使う。
- [ ] ac:6 raw logや顧客本文は複製せず、証跡はsource-owned URLまたはartifact referenceとして保存する。
- [ ] ac:7 ingest認証はserver-to-server credentialを要求し、認証主体がアクセスできないprojectへのreceiptを拒否する。
- [ ] ac:8 receipt deliveryの成否とsource runの成否を別フィールドとして扱い、delivery成功をrun成功と解釈しない。
- [ ] ac:9 同一identityの同時ingestはreceipt lockで直列化し、1件だけをcreate、残りをduplicateとして返す。lock取得不能時は部分保存せず明示的に失敗する。
- [ ] ac:10 production CSRF middlewareは `POST /api/run-receipts/ingest` だけをbrowser CSRF対象外にし、route側でserver-to-server credentialを必須化する。cookie/session-only POSTは拒否し、既存exemptionは変えない。
- [ ] ac:11 receipt workflowは共有WMC台帳へ保存しても既存Operational Inboxと `GET /api/workflows` から除外し、Agent Run Inboxだけに1回表示する。receipt＋非receipt混在時も非receiptの既存priorityは変えない。
- [ ] ac:12 `GET /api/run-receipts/inbox` のtimeout、network error、または5xx時は既存Workflow画面とOperational Inboxを維持し、Agent Run Inbox sectionだけを明示的な取得不能warningへ落とす。障害を空配列や0件成功へ丸めない。
- [ ] ac:13 Agent Run Inboxは `(project_id, source.type, source.workflow_id)` ごとに最新receipt runだけを表示する。古いblocked/failed履歴は台帳に保持するが、後続の新しいrunがある場合はInboxへ残さない。最新run選択後にfilter、priority、count、limitを適用する。
- [ ] ac:14 Inboxの全件順序はpriority、UTC instantへ正規化したeffective timestamp、persisted `created_at`、決定的run idでtotal orderにし、同値時もlimit/pagination結果を安定させる。UI取得・状態更新・通知はRun Receipt専用client/service、Reactive Store、EventBusへ分離し、`public/workflows.html` は購読と描画だけを担う。
- [ ] ac:15 JSON台帳への異なるreceipt identityの同時ingest、receiptと既存writerの競合、失敗transactionのrollbackをrepository-wide write transactionで直列化し、どのwriterのworkflow/run/step/auditも失わない。receipt identity lockを先に、shared-ledger transaction lockを後に取得する順序を固定する。同じasync transaction ownerによるnested transactionは外側へjoinしてqueue/file leaseを再取得せず、外側だけがcommit/rollbackする。JsonFile本番mutatorはtransaction外writeを拒否し、WorkflowService、WorkflowRunner、external_runnerを含む全production writerを短いtransaction境界へ移行する。

## Workflow State Scenarios

- `workflow state transition`: source `success` はBrainbase `success / closed / none` へ写る。ただし `evidence_state=unconfirmed|no_data` はInboxで確認対象として残る。
- `workflow state transition`: source `failed` は `failed / needs_action / check_error` へ写る。
- `workflow state transition`: source `blocked` は `needs_action / needs_action / resolve_blocker` へ写る。
- `workflow state transition`: source `waiting_human` は `waiting_human / open / review_run` へ写る。
- `workflow state transition`: source `cancelled` は `cancelled / closed / none` へ写り、successに含めない。
- `workflow retry matrix`: 同じproject/source/external run idで同一payloadの再送はduplicate、内容が異なる再送はconflictとして拒否する。
- `workflow retry matrix`: `delivery.attempt` と `delivery.sent_at` だけが変わった再送は同一payloadとしてduplicateになる。同一identityの同時送信も1件だけcreateされる。
- `workflow rollback guard`: contract、auth、project、idempotency conflictの検証が失敗した場合、workflow runやauditを部分保存しない。

## Failure Modes

- `schema_failure`: 未定義status/evidence state、空のidentity、壊れたevidence refは400で拒否する。
- `schema_failure`: source label、summary、blocker、action、metric、evidence label/refに改行・制御文字・上限超過・禁止keyがある場合は400で拒否する。connectorは送信前に顧客本文・secret・raw logを除去する。
- `auth_denied`: cookieだけのbrowser requestやproject非許可credentialは403で拒否する。
- `source_unavailable`: connectorがsourceへ接続できずsource run identityも得られない場合は、connector自身の観測試行を `observation_kind=connector_observation`、synthetic external run identity、`blocked + no_data|unconfirmed` として表現する。source runを失敗扱いに偽装しない。
- `delivery_failure`: connector側outbox/retryで扱い、Brainbaseに届いたreceiptのsource run statusを書き換えない。
- `receipt_inbox_failure`: receipt一覧APIの取得失敗はAgent Run Inboxだけにwarningを表示し、既存workflow一覧の取得・描画を巻き込まない。取得不能を0件と表示しない。
- `stale_receipt_history`: 同一source workflowの古いblocked/failed runは履歴として台帳に残すが、新しいrunより上位のInbox itemとして再表示しない。
- `shared_ledger_race`: receipt identityが異なっても共有JSON台帳は同じため、repository-wide transaction lockなしで全体ファイルをrenameしない。失敗transactionはdiskへrollback snapshotを書き戻さず、lock取得時点のdisk stateを維持する。
- `nested_transaction_deadlock`: 同一async contextのnested transactionをin-process queueの後ろへ再投入しない。inner callbackは外側transactionへjoinし、inner failureはtransactionをrollback-onlyにして、呼び出し側が例外をcatchしても外側commitを拒否する。
- `unserialized_writer`: JsonFile repositoryのmutation primitiveはactive transaction contextなしでは `workflow_repository_transaction_required` としてwrite前に拒否する。runtime serviceはremote handler、network、長時間sleepをfile lease内でawaitせず、各永続化まとまりだけを短いtransactionへ入れる。

## 非目標

- 4ソース固有のAPI接続・schedule・outbox実装は各connector Storyで扱う。
- Eve向け `external_runner.v0` を置き換えない。
- raw logs、顧客返信、transcriptをBrainbaseへ複製しない。
- receiptからGraph SSOTへ自動学習・自動昇格しない。

## Operator Surface

- 正本の利用面はWorkflow Mission Control内のAgent Run Inboxと `GET /api/run-receipts/inbox` とする。
- `no_data` と `unconfirmed` は成功色や0件表示へ混ぜず、warning badgeと根拠不足の説明を必ず表示する。
- `omitted_count` は現在のfilterには一致するが `limit` により返却されなかったreceipt数であり、source未確認数ではない。
- Agent Run Inboxはworkflow identityごとに最新runへ畳み込んだ後でfilterとpriorityを適用する。`count` は畳み込み後かつfilter一致後、limit適用前の件数であり、`has_more = count > items.length`、`omitted_count = count - items.length` とする。
- APIの並びはpriority昇順、effective timestampのUTC instant降順、persisted `created_at` のUTC instant降順、決定的run id辞書順降順とする。RFC 3339 offset表記を文字列比較せずepoch millisecondへ変換し、同じ集合とlimitに対して常に同じitemsを返す。
- 既存の非receipt workflow一覧・承認Inboxのpriorityは変更しない。receipt workflowは `GET /api/workflows` と既存Operational Inboxへ混入させず、receiptのpriorityはreceipt専用APIとUI sectionで一元化する。
- receipt UIは `public/modules/domain/run-receipt/` 配下のclient/serviceでAPI取得とfailure normalizationを行い、`appStore.runReceiptInbox` を更新して `EVENTS.RUN_RECEIPT_INBOX_LOADED|FAILED` を発火する。既存page-local workflow stateとはfailure boundaryを共有しない。
