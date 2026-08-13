# External Runtime Adapter Contract v0 Spec

## Contract

`external_runner.v0` はCloudflare/computerなどの外部実行面がBrainbaseへ返す実行結果の契約である。現行の実装対象は `runner.type=cloudflare_computer` と `runner.type=agent_report`。

## Required Fields

- `contract_version`: `external_runner.v0`
- `runner.type`
- `runner.external_run_id`
- `runner.agent_id`
- `runner.trace_ref`（`cloudflare_computer` の場合）
- `run.project_id`
- `run.role_agent_id`
- `run.status`
- `loop_control.owner_id`
- `loop_control.cost_owner_id`
- `loop_control.approval_owner_id`
- `loop_control.stop_conditions[]`
- `rounds[].round_id`
- `rounds[].status`
- `rounds[].evidence_refs[]`

## Gate Rules

- `cloudflare_computer` payloadは `runner.trace_ref` なしでは受け付けない。
- `rounds[].evidence_refs` が空なら受け付けない。
- statusは `completed`、`approval_required`、`waiting_human`、`blocked`、`cancelled`、`failed` のみ受け付ける。
- human waitにはactionableな `human_steps[]` を必須にする。
- blocked redactionおよびauto promotionを拒否する。
- Candidate Store I/O前にpending auditを保存し、失敗はdeferred/conflictとして可視化する。
- 冪等キーは `run.project_id + runner.type + runner.external_run_id` とし、project境界を越えない。
- service/internal credential以外はowner委任を認証主体本人に限定する。
- Graph SSOTへ自動昇格しない。

## Runtime Boundary

- Brainbaseは外部ランタイムのsession作成、stream polling、continuation token、provider固有schedulerを実装しない。
- Meeting note生成はingest responseの `note_generation_handoff` をCloudflare/computerが処理し、`POST /api/workflows/control/meeting-pack/note-generation` へ返す。
- 汎用実行結果は `POST /api/external-runner/ingest` へ返す。

## Verification

- `tests/server/services/external-runner-contract-schema.test.js`
- `tests/server/services/external-runner-ingest-service.test.js`
- `tests/server/routes/external-runner-routes.test.js`
- `tests/server/services/meeting-automation-service.test.js`
