---
story_id: story-cross-runtime-run-receipt-inbox-v1
title: Cross-runtime run receipt common control plane v1
status: completed
created_at: 2026-07-15
updated_at: 2026-07-15
horizon: quarter
view: business
period: 2026Q3
architecture_docs:
  - docs/architecture/ADR-016-run-receipt-control-plane-boundary.md
  - docs/architecture/story-cross-runtime-run-receipt-inbox-v1.md
  - docs/runbooks/run-receipt-inbox-v1.md
spec_docs:
  - docs/specs/cross-runtime-run-receipt-inbox-v1.md
---

# Cross-runtime run receipt common control plane v1

## 背景

Mana、Codex Automations、GitHub Actions、SalesTailorでは自動実行が増えているが、成否・停止理由・証跡の見え方がランタイムごとに分断されている。そのため、実行されていない状態を「0件」、証拠未取得を「成功」と誤認しやすく、人間が確認すべきrunを横断して発見できない。

BrainbaseにはWorkflow Mission Controlのrun台帳があり、Eve向けには詳細な `external_runner.v0` がある。4ソースの運用結果を集約するためにEve専用契約を流用すると、Role Agent、round、learning candidateなど不要な責務まで各connectorへ強制してしまう。

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
- [x] ac:12 `GET /api/run-receipts/inbox` のtimeout、network error、または5xx時は既存Workflow画面とOperational Inboxを維持し、Agent Run Inbox sectionだけを明示的な取得不能warningへ落とす。障害を空配列や0件成功へ丸めない。
- [x] ac:13 Agent Run Inboxは `(project_id, source.type, source.workflow_id)` ごとに最新receipt runだけを表示する。古いblocked/failed履歴は台帳に保持するが、後続の新しいrunがある場合はInboxへ残さない。最新run選択後にfilter、priority、count、limitを適用する。
- [x] ac:14 Inboxの全件順序はpriority、UTC instantへ正規化したeffective timestamp、persisted `created_at`、決定的run idでtotal orderにし、同値時もlimit/pagination結果を安定させる。UI取得・状態更新・通知はRun Receipt専用client/service、Reactive Store、EventBusへ分離し、`public/workflows.html` は購読と描画だけを担う。
- [x] ac:15 JSON台帳への異なるreceipt identityの同時ingest、receiptと既存writerの競合、失敗transactionのrollbackをrepository-wide write transactionで直列化し、どのwriterのworkflow/run/step/auditも失わない。receipt identity lockを先に、shared-ledger transaction lockを後に取得する順序を固定する。同じasync transaction ownerによるnested transactionは外側へjoinしてqueue/file leaseを再取得せず、外側だけがcommit/rollbackする。JsonFile本番のshared-ledger collection mutatorはtransaction外writeを拒否する。identity lock/lease metadataは台帳外の別control-plane stateとして同期し、lock操作は台帳reloadを行わない。startup seedは同じlease/ownerの初期化transaction、WorkflowService、WorkflowRunner、external_runnerを含む全production writerは短いtransaction境界、Candidate Store等の外部I/Oはlease外へ移す。external_runner candidateはcontract/workspace/org/project/runner/run/source candidateからglobal idを派生し、project/run scope markerと元source candidate idを `source_event_ids` に残す。Candidate Repositoryは同一primary idをdedupe keyに関係なく上書き前に拒否する。store済み未確定の再試行はfindById同値時だけ採用、相違時はactionable conflict、pending再開ではduplicate auditなし、全収束後だけ既存duplicate auditを維持する。

## Verification Evidence

- Unit / integration: run receipt contract、ingest、shared ledger transaction、Inbox API、UI client/service/viewを含むfocused regressionが全件pass。
- Browser E2E: tracked Playwrightで実server-to-server ingest、実Inbox API、latest-run collapse、priority、filter、failure boundary、既存の非receipt Operational Inbox itemの維持をcurrent HEADで確認。
- Failure semantics: API 503時も既存receipt snapshotを保持し、取得不能を0件へ丸めないことを確認。

## Scenarios

- S-001: Given a source reports `success`, when Brainbase projects the receipt, then it maps to `success / closed / none`; `unconfirmed|no_data` still remains visible for operator review. (AC-3, AC-4)
- S-002: Given a source reports `failed`, when Brainbase projects the receipt, then it maps to `failed / needs_action / check_error` without losing the evidence state. (AC-3, AC-4)
- S-003: Given a source reports `blocked`, when Brainbase projects the receipt, then it maps to `needs_action / needs_action / resolve_blocker` and ranks above failed runs. (AC-4, AC-5)
- S-004: Given a source reports `waiting_human`, when Brainbase projects the receipt, then it maps to `waiting_human / open / review_run`. (AC-4)
- S-005: Given a source reports `cancelled`, when Brainbase projects the receipt, then it remains `cancelled / closed / none` and is never counted as success. (AC-4)
- S-006: Given the same project/source/external run identity is delivered again, when normalized content is identical or only delivery metadata changes, then Brainbase returns duplicate; concurrent delivery creates exactly one run. (AC-2, AC-8, AC-9)
- S-007: Given the same identity is delivered with different normalized content, when ingest validates idempotency, then it rejects the conflict without ledger mutation. (AC-1, AC-2)
- S-008: Given schema, auth, project access, raw-content, or evidence validation fails, when ingest is attempted, then no workflow, run, step, or audit is partially saved. (AC-1, AC-6, AC-7, AC-10, AC-15)
- S-009: Given a confirmed filtered Inbox snapshot is visible, when the next filter request times out or returns 5xx, then Agent Run Inbox preserves both the confirmed items and their confirmed filters, shows unavailable, and leaves Operational Inbox usable. (AC-5, AC-11, AC-12, AC-14)
- S-010: Given source, project, run-status, and evidence-state filters, when they are composed, then only matching latest receipts are shown and an unavailable response is never interpreted as zero results. (AC-5, AC-11, AC-12)
- S-011: Given ingest or listing access, when authentication, CSRF, or project authorization is invalid, then the request is rejected without broadening the existing exemptions or revealing another project. (AC-1, AC-6, AC-10)
- S-012: Given an interrupted pending external_runner.v0 candidate delivery, when it is replayed, then exact stored candidates resume idempotently, mismatches remain actionable conflicts, and legacy post-convergence duplicate audit behavior is preserved. (AC-13, AC-15)
- S-013: Given the connector cannot obtain a source run identity, when it reports the attempt, then Brainbase records a visible connector observation rather than inventing a failed source run or an empty success. (AC-3, AC-4)
- S-014: Given an operator uses Workflow Mission Control, when receipts are loaded or filtered, then source status, uncertainty, action, evidence refs, labels, keyboard focus, and status-region warnings remain accessible and match API order. (AC-5, AC-11, AC-14)
- S-015: Given receipt and non-receipt workflows share the ledger, when legacy workflow, run, rerun, and Operational Inbox routes are used, then receipts stay isolated in Agent Run Inbox while existing non-receipt membership and priority remain unchanged. (AC-12, AC-13)
- S-016: Given the receipt Inbox request times out, fails at the network, or returns 5xx, when the failure is projected, then only Agent Run Inbox becomes unavailable and the confirmed snapshot, Workflow page, and Operational Inbox remain usable. (AC-11, AC-12, AC-14)
- S-017: Given multiple receipt runs for the same source workflow identity, when the Inbox is projected, then the latest run is selected before filters, count, priority, and limit so old failures are not resurrected. (AC-5)
- S-018: Given collapsed receipts have equal priority or equivalent instants with different offsets, when ordering and limiting are repeated, then epoch-based tie-breakers and deterministic run id yield the same items. (AC-5)
- S-019: Given the browser loads Agent Run Inbox, when data succeeds or fails, then a dedicated client and DI-composed service update the Reactive Store and EventBus without page-local HTTP access or mutation of legacy workflow state. (AC-11, AC-12)
- S-020: Given concurrent receipt and legacy writers share the JSON ledger, when commits, failures, startup seeding, nested transactions, or candidate-outbox recovery overlap, then guarded transactions preserve all committed workflow, run, step, and audit data without deadlock or rollback overwrite. (AC-8, AC-9, AC-13, AC-15)

## Failure Modes

- `schema_failure`: 未定義status/evidence state、空のidentity、壊れたevidence refは400で拒否する。
- `schema_failure`: source label、summary、blocker、action、metric、evidence label/refに改行・制御文字・上限超過・禁止keyがある場合は400で拒否する。connectorは送信前に顧客本文・secret・raw logを除去する。
- `auth_denied`: cookieだけのbrowser requestやproject非許可credentialは403で拒否する。
- `source_unavailable`: connectorがsourceへ接続できずsource run identityも得られない場合は、connector自身の観測試行を `observation_kind=connector_observation`、synthetic external run identity、`blocked + no_data|unconfirmed` として表現する。source runを失敗扱いに偽装しない。
- `delivery_failure`: connector側outbox/retryで扱い、Brainbaseに届いたreceiptのsource run statusを書き換えない。
- `receipt_inbox_failure`: receipt一覧APIの取得失敗はAgent Run Inboxだけにwarningを表示し、既存workflow一覧の取得・描画を巻き込まない。取得不能を0件と表示しない。
- `stale_receipt_history`: 同一source workflowの古いblocked/failed runは履歴として台帳に残すが、新しいrunより上位のInbox itemとして再表示しない。
- `shared_ledger_race`: receipt identityが異なっても共有JSON台帳は同じため、repository-wide transaction lockなしで全体ファイルをrenameしない。失敗transactionはdiskへrollback snapshotを書き戻さず、lock取得時点のdisk stateを維持する。
- `receipt_identity_lock_timeout`: `workspace_id=run_receipt:<project_id>` と決定的run idのlockをbounded retryで取得できない場合は、書込前に停止し、`Retry-After` 付きHTTP 503として再試行可能性を明示する。payload不正やidentity conflictの400とは分離する。
- `nested_transaction_deadlock`: 同一async contextのnested transactionをin-process queueの後ろへ再投入しない。inner callbackは外側transactionへjoinし、inner failureはtransactionをrollback-onlyにして、呼び出し側が例外をcatchしても外側commitを拒否する。
- `unserialized_writer`: JsonFile repositoryのshared-ledger collection mutation primitiveはactive transaction contextなしでは `workflow_repository_transaction_required` としてwrite前に拒否する。identity lock/lease metadataは台帳外で同期し、lock操作で台帳をreloadしない。runtime serviceはremote handler、network、Candidate Store、長時間sleepをfile lease内でawaitせず、各永続化まとまりだけを短いtransactionへ入れる。
- `bootstrap_seed_race`: seed workflowはrepository公開前に同じfile leaseとtransaction ownerで初期化し、既存台帳をreload後に不足分だけ追加する。constructorから通常mutatorをguard外呼び出ししない。
- `candidate_outbox_interruption`: external_runnerのcandidate intentを台帳へ先にcommitし、実行スコープから派生したglobal candidate idでlease外保存後に結果を短いtransactionで確定する。store済み未確定のexact replayはfindByIdでimmutable projectionが一致する場合だけ採用し、相違はpending/actionable conflictとして拒否する。pending再開はduplicate auditを書かず、全intent収束後の次回duplicateだけ既存 `external_runner.duplicate_replay_ignored` auditを短いtransactionで書く。

## 非目標

- 4ソース固有のAPI接続・schedule・outbox実装と、本番runを使ったsource別canaryは後続の各connector Storyで扱う。本Storyのcompletedは共通control-plane基盤の完成を意味し、4ソース本接続の完了を意味しない。
- Eve向け `external_runner.v0` を置き換えない。
- raw logs、顧客返信、transcriptをBrainbaseへ複製しない。
- receiptからGraph SSOTへ自動学習・自動昇格しない。

## Operator Surface

- 正本の利用面はWorkflow Mission Control内のAgent Run Inboxと `GET /api/run-receipts/inbox` とする。
- `no_data` と `unconfirmed` は成功色や0件表示へ混ぜず、warning badgeと根拠不足の説明を必ず表示する。
- `omitted_count` は現在のfilterには一致するが `limit` により返却されなかったreceipt数であり、source未確認数ではない。
- Agent Run Inboxはworkflow identityごとに最新runへ畳み込んだ後でfilterとpriorityを適用する。`count` は畳み込み後かつfilter一致後、limit適用前の件数であり、`has_more = count > items.length`、`omitted_count = count - items.length` とする。
- APIの並びはpriority昇順、effective timestampのUTC instant降順、persisted `created_at` のUTC instant降順、決定的run id辞書順降順とする。RFC 3339 offset表記を文字列比較せずepoch millisecondへ変換し、同じ集合とlimitに対して常に同じitemsを返す。
- 既存の非receipt workflow一覧・承認Inboxのpriorityは変更しない。receipt workflow/runは汎用workflow/run APIの一覧・詳細・更新・実行・再実行と既存Operational Inboxへ混入させず、receiptのpriorityと将来の操作はreceipt専用APIとUI sectionで一元化する。
- receipt UIは `public/modules/domain/run-receipt/` 配下のclient/serviceでAPI取得とfailure normalizationを行い、`appStore.runReceiptInbox` を更新して `EVENTS.RUN_RECEIPT_INBOX_LOADED|FAILED` を発火する。既存page-local workflow stateとはfailure boundaryを共有しない。
