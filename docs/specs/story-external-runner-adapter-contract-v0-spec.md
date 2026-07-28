# Eve Runtime Adapter Contract v0 Spec

## Contract

`external_runner.v0` は、Eveなどの外部Agent RuntimeがBrainbaseへ返す実行結果の契約である。v0では `runner.type=eve` を実装対象にする。

## Required Fields

- `contract_version`: `external_runner.v0`
- `runner.type`: `eve`
- `runner.external_run_id`
- `runner.agent_id`
- `runner.eve.trace_ref`
- `run.project_id`
- `run.role_agent_id`
- `run.status`
- `loop_control.owner_id`
- `loop_control.cost_owner_id`
- `loop_control.approval_owner_id`
- `loop_control.stop_conditions[]`
- `context_sources[].source_type`
- `context_sources[].source_ref`
- `rounds[].round_id`
- `rounds[].status`
- `rounds[].evidence_refs[]`
- `learning_candidates[].candidate_id`
- `learning_candidates[].cognitive_type`
- `learning_candidates[].body`

## Mapping

| Contract Field | Brainbase Surface |
|---|---|
| `run.workflow_id` | `workflows.id` |
| `run.project_id + runner.type + runner.external_run_id` | `workflow_runs.id` のproject-scoped冪等キー |
| `context_sources[]` | `workflow_context_sources` と `context_snapshots` |
| `human_steps[]` | `workflow_human_steps` |
| `outputs[]` | `workflow_outputs` |
| `rounds[]` | `workflow_audit_logs` |
| `judgment_dag_trace` | `workflow_runs.metadata.judgment_dag_trace` |
| `learning_candidates[]` | Candidate Store、またはdeferred audit |

## Diagrams

- kind: flow
  path: `docs/architecture/external-runner-adapter-contract-architecture.md`
  purpose: EveからBrainbase Workflow Mission Control、Candidate Store、Graph SSOTまでのingest flowを示す。
- kind: state
  path: `docs/architecture/external-runner-adapter-contract-architecture.md`
  purpose: Eve run statusからBrainbase workflow run state、human wait、failure、duplicate、rejectへ写る状態遷移を示す。

## Scenario Clauses

- S-001: `workflow state transition` Eve `completed` runは `success / closed / none` に写り、context/output/audit/learning candidateの保存を伴う。
- S-002: `workflow state transition` Eve `approval_required` runは `waiting_human / open / approve` に写り、human stepがないpayloadは拒否される。
- S-002b: `workflow state transition` Eve `waiting_human` runも `waiting_human / open / approve` に写り、human stepがないpayloadは拒否される。
- S-003: `workflow state transition` Eve `cancelled` runは `cancelled / closed` に写る。
- S-004: `workflow retry matrix` 同一 `run.project_id + runner.type + runner.external_run_id` はduplicateとして既存runを返し、二重保存しない。別projectの同一 `runner.external_run_id` は別runとして扱い、project境界をまたいで既存runを返さない。
- S-004b: `workflow rollback guard` `run.workflow_id` が既存Workflowと衝突した場合、既存Workflowの `project_id` とpayloadの `run.project_id` が一致しなければ保存前に拒否し、別projectのWorkflow配下へrunを混入させない。Story ACは `ac:7`。
- S-004d: `workflow rollback guard` `run.workflow_id` 未指定時のfallback Workflow IDは `run.project_id` を含み、同じEve agentでもprojectをまたいで同一Workflow IDを共有しない。Story ACは `ac:7`。
- S-004c: `workflow ownership guard` service/internal credential以外の外部runner requestは、`loop_control.owner_id`、`cost_owner_id`、`approval_owner_id` を認証主体本人以外へ委任できない。Story ACは `ac:8`。
- S-004e: `workflow ownership guard` service/internal credential以外の外部runner requestでは、未指定の `learning_candidates[].actor_person_id` を認証主体本人に固定し、runner agentをCandidate Store上の人間actorとして暗黙保存しない。Story ACは `ac:8`。
- S-005: `workflow rollback guard` Learning CandidateはGraph SSOTへauto promoteせず、Candidate Storeまたは監査可能なpending/deferred/conflict状態へ残す。
- S-005b: `workflow rollback guard` Candidate Store接続時のretryableなwrite失敗は、API失敗で隠さずdeferred auditとして残し、duplicate replayで再試行できるようにする。
- S-005c: `workflow rollback guard` 派生済みglobal candidate idが既存Candidateと衝突した時は、既存Candidateのimmutable projectionが完全一致する場合だけstoredとして採用する。不一致またはduplicate後に取得不能なら `external_runner.candidate_conflict`、`persistence_status=pending`、`action_required=resolve_candidate_conflict` を監査へ残してrequestを明示的に失敗させる。
- S-005d: `workflow retry matrix` Candidate Store I/O前にpending auditを共有Workflow台帳へ保存し、外部I/Oは台帳transactionの外で実行する。stored/deferred/conflictへの遷移は短い共有transactionで確定し、duplicate replayはpending Candidateのみ再開して監査行を二重生成しない。
- S-006: `workflow auth boundary` `/api/external-runner` は `workflowAuthGuard` 配下に置かれる。
- S-007: `compatibility guard` 既存の `/api/sessions/report_activity` CSRF例外はローカルhook/CLI telemetry用として維持し、外部runner ingestのserver-to-server認証境界とは混ぜない。

## Gate Rules

- Eve payloadは `runner.eve.trace_ref` なしでは受け付けない。
- `rounds[].evidence_refs` が空なら受け付けない。
- `run.status` は `completed`、`approval_required`、`waiting_human`、`blocked`、`cancelled`、`failed` のみ受け付ける。
- `run.status=approval_required` または `run.status=waiting_human` では、actionable prompt/title/description/reasonを持つ `human_steps[]` を必須にする。
- `context_sources[].redaction_status=blocked` は受け付けない。
- `learning_candidates[]` はCandidate Storeへ渡す前に `candidate_id`、`cognitive_type`、`body` を必須検証する。
- `learning_candidates[].promotion_policy=auto_promote` は受け付けない。
- 外部runnerから来た `learning_candidates[].promotion_status` と `learning_candidates[].requires_approval` は信頼せず、Brainbase側で `promotion_status=candidate` と `requires_approval=true` に固定する。
- Candidate Store I/O前に `persistence_status=pending` のauditを保存し、外部I/O中は共有Workflow台帳transactionを保持しない。
- retryableなCandidate Store write失敗は `persistence_status=deferred` として可視化し、duplicate replayでpending/deferred Candidateを再試行する。
- global candidate idのduplicateは既存Candidateのimmutable projectionを照合し、完全一致だけをstoredとして採用する。不一致または取得不能は `external_runner.candidate_conflict` と `action_required=resolve_candidate_conflict` で明示的に失敗させる。
- 同一 `run.project_id + runner.type + runner.external_run_id` はduplicateとして扱い、二重保存しない。
- `run.workflow_run_id` がpayloadに含まれても冪等キーには使わず、Brainbase側で `run.project_id + runner.type + runner.external_run_id` からrun idを決める。
- 別projectで同じ `runner.external_run_id` が送られてもduplicate replayせず、project-scopedな別runとして保存する。
- `loop_control.stop_conditions[]` の各要素は非空文字列でなければならない。
- `run.workflow_id` が既存Workflowを指す場合は、既存Workflowの `project_id` とpayloadの `run.project_id` が一致することを必須にする。一致しない場合は `workflow_project_mismatch` として保存前に拒否する。
- `run.workflow_id` 未指定時に生成するWorkflow IDは `run.project_id` と `runner.agent_id` から決め、project境界をまたがない。
- service/internal credential以外のrequestでは、`loop_control.owner_id`、`loop_control.cost_owner_id`、`loop_control.approval_owner_id` が認証主体本人と一致することを必須にする。一致しない場合は `loop_control_delegation_not_allowed` として保存前に拒否する。
- service/internal credential以外のrequestでは、未指定の `learning_candidates[].actor_person_id` を認証主体本人としてingestへ渡す。
- `run.status=cancelled` はBrainbaseのcancelled runとして保存し、success扱いしない。
- `/api/external-runner` はWorkflow系APIと同じ認証境界で登録する。
- `/api/external-runner` はCSRFトークンに依存しないserver-to-server APIとして扱うが、cookie認証だけのbrowser session requestは拒否する。
- `/api/sessions/report_activity` の既存CSRF例外は変更対象外であり、外部runner ingestの認証・承認契約を広げる根拠にしない。

## Known v0 Boundary

- 共通run receipt control plane導入後は、Workflow本体、run、context、output、audit、Candidate状態の台帳更新にrepository-wide transactionを使う。一方、Candidate Storeの外部I/O自体は共有台帳transactionの外に置き、pending auditとstored/deferred/conflict auditで挟む。この後方互換hardeningによりretryable failureとidentity conflictを区別するが、Candidate StoreとWorkflow台帳を単一の分散transactionへ統合することは引き続きv0の外側とする。

## Verification

- `tests/server/services/external-runner-ingest-service.test.js`
- `tests/server/routes/external-runner-routes.test.js`
- `tests/e2e/story-external-runner-adapter-contract-v0-contract.spec.ts`
- `tests/unit/csrf-report-activity-exempt.test.js`
- `tests/server/services/workflow-runner.test.js`
- `tests/server/routes/workflows.test.js`
