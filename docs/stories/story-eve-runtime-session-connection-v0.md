---
story_id: story-eve-runtime-session-connection-v0
title: Eve Runtime Session Connection v0
status: active
created_at: 2026-06-26
updated_at: 2026-06-27
architecture_docs:
  - docs/architecture/eve-runtime-session-connection-architecture.md
spec_docs:
  - docs/specs/story-eve-runtime-session-connection-v0-spec.md
related_stories:
  - story-external-runner-adapter-contract-v0
  - story-mana-meeting-workflow-pack-data-v1
  - story-meeting-workflow-calendar-input-v1
  - story-meeting-review-package-ingest-v1
---

# Eve Runtime Session Connection v0

## 背景

BrainbaseはBusiness Loop Control Planeであり、Role Agent、Workflow選択、Loop Eligibility、承認、証跡、Graph SSOT、Learning Candidateの正本を持つ。Eveはその中心ではなく、Brainbase管理下の外部Agent Runtimeである。

これまでの `external_runner.v0` は、Eveなどの外部runnerが完了後にBrainbaseへ返す結果契約を定義していた。次に必要なのは、BrainbaseがLoop IntentをEve sessionへ実際にdispatchし、そのsession参照をWorkflow Mission Controlへ残すことである。

## User Story

Brainbase operatorとして、Loop IntentをEve sessionとして起動し、Eveのsession idとcontinuation tokenをBrainbaseのWorkflow Runへ紐づけたい。なぜなら、Meeting Workflow Packを実ランタイムへ接続しても、判断資産、承認、証跡、学習候補の正本をBrainbaseに残したいから。

## Acceptance Criteria

- [ ] ac:1 BrainbaseはLoop IntentからEve公式API `POST /eve/v1/session` へsession作成requestを送れる。
- [ ] ac:2 Eveへ渡すpayloadは `message` と `context` を持ち、`context.brainbase_handoff_version=eve_session_handoff.v0` と `expected_result_contract=external_runner.v0` を含む。
- [ ] ac:3 Eve responseの `x-eve-session-id` と `continuationToken` はBrainbaseのWorkflow Run metadataとLoop Intent metadataへ保存される。
- [ ] ac:4 dispatch時点ではGraph SSOT昇格、外部送信、契約作成、公開を行わず、Eveの結果は後続の `external_runner.v0` ingestでBrainbaseへ戻す。
- [ ] ac:5 Eve client未設定時はEveへ送らず、Workflow RunやLoop Intentを部分保存せずにfail loudする。
- [ ] ac:6 同一Loop Intentに既存Eve sessionがあり、Control Refが有効な場合は、明示的なforceなしに二重sessionを作らずidempotent replayとして返す。
- [ ] ac:7 dispatch runは `workflow_runs`、`run_steps`、`context_snapshots`、`audit_logs` に証跡を残し、Mission Controlから追跡できる。
- [ ] ac:8 disabled、scope不一致、またはlineage不一致のRole Agent / Template / Binding / Triggerを参照するLoop Intentはdispatch前に拒否する。
- [ ] ac:9 `/workflows` のWorkflow Control UIはLoop Intent行からEve dispatchを実行でき、既存sessionの再表示と明示的な新規session作成を区別して表示する。
- [ ] ac:10 Brainbase API / UI / handoff / list surfaceは `continuation_token` を返さず、`continuation_token_present` だけを返す。
- [ ] ac:11 Brainbase API callerが `continuation_token` / `continuationToken` を指定した場合は、Eve APIを呼ぶ前に `blocked_eve_continuation_token_input` で拒否する。

## Workflow State Scenarios

- `workflow state transition`: `Loop Intent ready / needs_approval` はEve session作成後、Brainbase `workflow_runs.status=running`、`action_required=await_eve_result`、`loop_intents.status=dispatched` へ遷移する。
- `workflow state transition`: Eve未設定時は `blocked_eve_not_configured` として保存前に止まる。
- `workflow retry matrix`: 既存 `loop_intents.metadata.eve_session_ref.session_id` がある再実行は、forceなしではEve APIを再度呼ばず、既存sessionを返す。ただし `workflow_run_id` が保存されている場合、そのrun / workflowが同一workspace / org / project / Loop Intent / Eve dispatch implementationに属することを確認してから返す。
- `workflow retry matrix`: `force_new_session` または `forceNewSession` が明示された場合だけ、既存session refを上書きする新規Eve sessionを作る。この時も過去の `continuation_token` はEve handoff / API responseへ露出させず、新旧sessionのWorkflow Run idは衝突しない。
- `workflow ownership guard`: `continuation_token` はBrainbaseの内部保存値であり、API callerからEveへ中継しない。外部入力があれば `blocked_eve_continuation_token_input` として保存前に止める。
- `workflow rollback guard`: Eve dispatchは実行開始の証跡だけを保存し、output、human step、learning candidateはEve結果の `external_runner.v0` ingestまで作らない。
- `workflow rollback guard`: Eve session作成後にBrainbase永続化が失敗した場合は、recovery用Workflow Run / audit / Loop Intent metadataをbest-effortで残し、operator reconciliation対象として重複session作成を防ぐ。
- `workflow ownership guard`: Eveに渡すcontextはBrainbaseのLoop Controlを含むが、EveはGraph SSOTや外部送信の最終権限を持たない。
- `workflow ownership guard`: Bindingが既存 `workflow_id` を指す場合、またはBrainbaseがfallbackのEve dispatch Workflow IDを生成する場合、そのWorkflowは既に `implementation_key=eve-session-dispatch` でなければならず、汎用WorkflowをEve dispatch用に上書きしない。
- `workflow UI surface`: `/workflows` からLoop IntentをEveへ送れるが、失敗時は画面にエラーを出し、Loop Intent操作を消さない。dispatch不可や送信中は理由を表示し、二重clickで重複sessionを作らない。Eve dispatch Workflow / Runでは汎用の実行・Rerun操作を表示せず、Loop Intent Eve session APIを入口として示す。Run Trace上の永続化済み `stop_conditions` が配列でない場合は空扱いにせず、警告として表示する。

## Failure Modes

- `config_missing`: `EVE_API_BASE_URL` 未設定ではdispatchを拒否し、部分runを残さない。
- `eve_session_create_failed`: Eve APIがnon-2xxやtimeoutを返した場合は `blocked_eve_session_create_failed` としてfail loudし、Brainbaseのrunを成功扱いしない。
- `eve_session_id_missing`: Eve responseにsession idがない場合は `blocked_eve_session_id_missing` として、reconnect不能なため保存前に拒否する。
- `message_empty`: 明示された `message` が空文字の場合は `blocked_eve_message_required` として、Eve API呼び出し前に拒否する。
- `eve_timeout_env_invalid`: `EVE_API_TIMEOUT_MS` が不正な値でもtimeout無効化にはせず、既定値へ丸める。
- `eve_dispatch_persistence_failed`: Eve session作成後にBrainbase側のrun/context/audit保存が失敗した場合は `blocked_eve_dispatch_persistence_failed` としてrecovery runを残す。
- `eve_session_ref_scope_mismatch`: 既存 `eve_session_ref.workflow_run_id` が別workspace / org / project / Loop Intent / Workflowを指す場合はidempotent replayせず、Eve API呼び出し前に拒否する。
- `scope_mismatch`: Loop Intentのorg/projectとcontrol refのorg/projectが一致しない場合は拒否する。
- `control_lineage_mismatch`: 同じorg/project内でも、BindingのRole Agent / Template、Triggerの親Binding、`trigger_id` と `workflow_trigger_id` が一致しない場合は拒否する。
- `manual_run_path_blocked`: 汎用 `/api/workflows/:workflowId/run` は404へ落とし、Eve dispatch用workflowのrerunも拒否する。実行は必ずLoop Intent Eve session APIを通る。

## 非目標

- EveをBrainbaseの正本DBにしない。
- Eveのstream eventをv0で全てWorkflow outputへ同期しない。
- Eve結果をGraph SSOTへ直接昇格しない。
- Meeting Review Package Ingestを削除しない。Eve未接続時のCodex生成Package経路は暫定経路として残す。
