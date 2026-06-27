---
story_id: story-eve-runtime-session-connection-v0
title: Eve Runtime Session Connection v0 Spec
status: active
created_at: 2026-06-26
updated_at: 2026-06-27
diagrams:
  - kind: flow
    path: docs/architecture/eve-runtime-session-connection-architecture.md
    purpose: Loop IntentからEve session作成、Brainbase Workflow Mission Control保存、Eve結果ingestまでの流れを示す。
  - kind: state
    path: docs/architecture/eve-runtime-session-connection-architecture.md
    purpose: dispatch可能、設定不足、scope / lineage mismatch、session記録、idempotent replay、結果ingest、Human Gateまでの状態遷移を示す。
  - kind: threat_model
    path: docs/architecture/eve-runtime-session-connection-architecture.md
    purpose: Eve runtimeに実行を委譲してもGraph昇格と外部送信をBrainbase Human Gateで止める境界を示す。
---

# Eve Runtime Session Connection v0 Spec

## Contract

`eve_session_handoff.v0` は、BrainbaseがLoop IntentをEve sessionへdispatchするための送信契約である。Eveの実行結果は別契約 `external_runner.v0` としてBrainbaseへ戻る。

## API

### Brainbase API

`POST /api/workflows/control/loop-intents/:loopIntentId/eve-session`

Request body:

- `message`: optional。未指定ならBrainbaseがRole Agent / Workflow Template / Triggerから生成する。指定する場合は空文字不可。
- `force_new_session`: optional。trueの時だけ既存session refがあっても新規sessionを作る。
- `forceNewSession`: optional。UI / JS client用のcamelCase alias。trueの時だけ既存session refがあっても新規sessionを作る。

`continuation_token` / `continuationToken` はBrainbase内部の保存値であり、Brainbase APIのcaller inputとしては受け付けない。callerが指定した場合はEve APIを呼ぶ前に `blocked_eve_continuation_token_input` で拒否する。

Response:

- `eve_session_dispatch.org_id`
- `eve_session_dispatch.project_id`
- `eve_session_dispatch.loop_intent_id`
- `eve_session_dispatch.idempotent`
- `eve_session_dispatch.state_transitions[]`
- `eve_session_dispatch.workflow`
- `eve_session_dispatch.run`
- `eve_session_dispatch.loop_intent`
- `eve_session_dispatch.eve_session.session_id`
- `eve_session_dispatch.eve_session.continuation_token_present`
- `eve_session_dispatch.handoff.message`
- `eve_session_dispatch.handoff.context`

### Eve API

`EveSessionClient.createSession` は公式Eve APIに合わせて以下を送る。

- method: `POST`
- path: `/eve/v1/session`
- headers:
  - `content-type: application/json`
  - `authorization: Bearer <EVE_API_TOKEN>` when token is configured
- body:
  - `message`
  - `context`
  - `continuationToken` はv0ではcaller inputから渡さない。resumeはBrainbaseに保存済みの `eve_session_ref` をControl Ref検証したidempotent replayとして扱う。

Success mapping:

| Eve response | Brainbase field |
|---|---|
| `x-eve-session-id` | `workflow_runs.metadata.runner.session_id` |
| `continuationToken` | `loop_intents.metadata.eve_session_ref.continuation_token` |
| response body | not trusted as Brainbase output in v0 |

## Handoff Context

`handoff.context` must include:

- `brainbase_handoff_version`: `eve_session_handoff.v0`
- `expected_result_contract`: `external_runner.v0`
- `source_of_truth`: `brainbase`
- `loop_intent`
- `role_agent_instance`
- `workflow_template`
- `workflow_binding`
- `workflow_trigger`
- `loop_control`
- `write_back_rules`

`handoff.context.loop_intent.metadata.eve_session_ref.continuation_token` must be omitted. Brainbase may store the continuation token internally, but Eve handoff, Brainbase API response, Workflow Run detail/list API, and Loop Intent list API expose only `continuation_token_present`. If Eve returns no continuation token, public surfaces must omit `continuation_token` instead of returning `continuation_token:null`.

`loop_control.stop_conditions` must contain at least one stop condition. If a custom Workflow Binding omits stop conditions, Brainbase supplies the v0 default stop conditions instead of sending an empty array to Eve. Each item must be a non-empty string; Brainbase must reject malformed Workflow Binding / Loop Intent / Eligibility values before Eve dispatch instead of coercing objects, treating non-array persisted values as absent, or converting empty values into strings.

`write_back_rules` must include:

- `external_send_requires_brainbase_human_gate=true`
- `graph_promotion_requires_candidate_store=true`
- `learning_candidates_require_redaction_check=true`

## Diagrams

- kind: flow
  path: `docs/architecture/eve-runtime-session-connection-architecture.md`
  purpose: Loop IntentからEve session作成、Brainbase Workflow Mission Control保存、Eve結果ingestまでの流れを示す。
- kind: state
  path: `docs/architecture/eve-runtime-session-connection-architecture.md`
  purpose: dispatch可能、設定不足、scope / lineage mismatch、session記録、idempotent replay、結果ingest、Human Gateまでの状態遷移を示す。
- kind: threat_model
  path: `docs/architecture/eve-runtime-session-connection-architecture.md`
  purpose: Eve runtimeに実行を委譲してもGraph昇格と外部送信をBrainbase Human Gateで止める境界を示す。

## Scenario Clauses

- S-001: workflow state transitionとして、dispatch可能なLoop IntentはEve session作成後、Workflow Runへ `running / open / await_eve_result` として保存される。
- S-002: workflow state transitionとして、Eve client未設定時は `blocked_eve_not_configured` として拒否され、Workflow Run、Run Step、Loop Intent更新を行わない。
- S-003: workflow retry matrixとして、同一Loop Intentに `metadata.eve_session_ref.session_id` があり、Control Ref検証を通過する場合は、forceなしではEve APIを呼ばずidempotent replayを返す。`metadata.eve_session_ref.workflow_run_id` がある場合は、そのrun / workflowが同一workspace / org / project / loop_intent_id / workflow_id / `implementation_key=eve-session-dispatch` に属することも検証する。`force_new_session` / `forceNewSession` がtrueの時だけ新規sessionを作る。
- S-004: workflow rollback guardとして、Eve dispatch成功時点では `workflow_outputs`、`workflow_human_steps`、Learning Candidate、Graph昇格、外部送信を作らない。
- S-005: workflow state transitionとして、Eve non-2xxまたはnetwork errorは `blocked_eve_session_create_failed` として拒否し、Workflow Run、Run Step、Context Snapshot、Loop Intent更新を行わない。
- S-006: workflow state transitionとして、Eve responseにsession idがない場合は `blocked_eve_session_id_missing` として拒否し、Workflow Run、Run Step、Context Snapshot、Loop Intent更新を行わない。
- S-007: workflow state transition guardとして、Role Agent / Template / Binding / TriggerがLoop Intentのorg/project境界に合わない場合、またはBinding/Trigger lineageが同じLoop Control bundleを指さない場合はdispatch前に拒否する。
- S-008: workflow UI stateとして、`/workflows` UIはLoop Intent行からEve dispatchを実行し、成功、idempotent replay、force新規session、失敗を画面内状態として表示する。Run Traceの永続化済み `stop_conditions` が配列でない場合は、空扱いにせず警告として表示する。
- S-009: workflow output boundaryとして、Eve stream NDJSONは `readSessionStream` で読めるが、v0ではWorkflow output同期までは行わない。
- S-010: workflow privacy guardとして、force新規session時も既存 `continuation_token` は `handoff.context` とAPI responseへ露出せず、sessionごとに一意なWorkflow Run idを保存する。`continuation_token` が `null` の場合も公開面には返さず、`continuation_token_present=false` として返す。
- S-011: workflow UI stateとして、dispatch不可のLoop Intentは `/workflows` UIに理由を表示し、dispatch中は同じLoop Intentの二重clickを抑止する。
- S-012: workflow state transition guardとして、`implementation_key=eve-session-dispatch` のWorkflowは汎用run / rerun経路から実行できず、Eve session dispatch APIだけを入口にする。
- S-013: workflow rollback guardとして、Eve session作成後にBrainbase永続化が失敗した場合は `blocked_eve_dispatch_persistence_failed` を返し、recovery用Workflow Run / audit / Loop Intent metadataをbest-effortで残す。
- S-014: workflow state transition guardとして、Bindingが既存 `workflow_id` を指す場合、またはBrainbaseがfallbackのEve dispatch Workflow IDを生成する場合、そのWorkflowの `implementation_key` が `eve-session-dispatch` でなければdispatch前に拒否する。
- S-015: workflow privacy guardとして、Eve session idは `x-eve-session-id` headerからのみ採用し、response bodyのsession idはBrainbase正本として信頼しない。
- S-016: workflow retry matrixとして、同一Loop IntentのEve dispatchはcross-process lockを取得してから実行し、Eve create timeoutはremote session状態不明として `blocked_eve_session_timeout_recovery_required` のrecovery run / audit / Loop Intent metadataを保存し、自動retryで二重sessionを作らない。

## Gate Rules

- `EVE_API_BASE_URL` が未設定ならEveへ送らない。
- `EVE_API_TIMEOUT_MS` が不正値ならtimeout無効化ではなく既定値に丸める。
- `message` は空文字不可。
- caller supplied `continuation_token` / `continuationToken` は受け付けず、Eve APIを呼ぶ前に `blocked_eve_continuation_token_input` で拒否する。
- `EveSessionClient.createSession` は `continuationToken` / `continuation_token` inputを受け付けず、内部callerでもBrainbase所有のidempotent replay境界を迂回できない。
- `loop_control.stop_conditions` は空配列不可で、各要素は非空文字列でなければならない。永続化済み値が非配列の場合も欠落扱いにせず拒否する。
- Eve non-2xx responseは成功扱いしない。
- Eve create timeoutは通常のnetwork errorに丸めず、unknown remote stateのrecovery runを作り、operator reconciliationまで同一Loop Intentの再dispatchを拒否する。
- Eve error responseがmalformed JSONでも、BrainbaseはHTTP statusを失わず `eve_status` として返す。
- Eve dispatchだけでは `workflow_outputs`、`workflow_human_steps`、Learning Candidateを作らない。
- `loop_intents.enabled=false`、`loop_intents.status=blocked/human_only/cancelled/canceled`、`eligibility.status=blocked/human_only`、または `blocked_reasons` があるLoop IntentはEve dispatch対象外にする。
- Workflow BindingのRole Agent / Template、Workflow Triggerの親Binding、Loop Intentの `trigger_id` / `workflow_trigger_id` は同じControl bundleとして一致していなければならない。
- 既存 `eve_session_ref` のidempotent replayもControl Ref検証後にだけ返す。`workflow_run_id` が保存されている場合は参照先run / workflowのworkspace、org、project、loop_intent_id、workflow_id、implementation_keyも一致していなければならない。
- Bindingの `workflow_id` が既存Workflowを指す場合、またはfallback生成されるWorkflow IDが既存Workflowと衝突する場合、そのWorkflowは `implementation_key=eve-session-dispatch` でなければならない。
- `loop_intents.metadata.eve_session_ref` にはsession idとcontinuation tokenを保存するが、response bodyをBrainbase outputとして信頼しない。
- `handoff.context`、API response、`context_snapshots`、run/list APIは continuation tokenそのものを返さず、`continuation_token_present` だけを返す。
- Run Traceは永続化済み `stop_conditions` が配列でない場合にsilent defaultせず、警告として表示する。
- Eve dispatch workflowは汎用run / rerun APIで実行しない。UIもEve dispatch Workflow / Runに汎用の実行・Rerun操作を表示しない。
- Eve session作成後のBrainbase永続化失敗は成功扱いせず、operator reconciliation用のblocked recovery runとして可視化する。
- 同一Loop IntentのEve dispatchはrepository lockで一度に1つだけ進め、別processでlock取得済みの場合はEve APIを呼ぶ前に `blocked_eve_dispatch_in_progress` として拒否する。
- `operator_reconcile_eve_session`、`operator_reconcile_eve_session_timeout`、`EVE_API_TOKEN` ローテーション、raw `continuation_token` を含むvar-dir状態ファイルの権限境界は `docs/brainbase-capabilities/runbooks/eve-session-dispatch-recovery.md` に従う。

## Verification

- `tests/server/services/eve-session-client.test.js`
- `tests/server/services/workflow-org-agent-control.test.js`
- `tests/server/routes/workflows.test.js`
- `tests/e2e/story-eve-runtime-session-connection-v0-contract.spec.ts`

## 公式参照

- https://vercel.com/docs/eve
