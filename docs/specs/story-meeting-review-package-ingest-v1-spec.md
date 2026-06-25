---
story_id: story-meeting-review-package-ingest-v1
title: Meeting Review Package Ingest v1 Spec
status: active
created_at: 2026-06-25
updated_at: 2026-06-25
diagrams:
  - kind: flow
    path: docs/architecture/meeting-review-package-ingest-architecture.md
    purpose: Codex生成Review PackageをWorkflow Mission Controlのrun/output/human step/auditへ載せるflowを示す。
  - kind: state
    path: docs/architecture/meeting-review-package-ingest-architecture.md
    purpose: package受領からwaiting_human、partial approval、all approvals completed、blocked系停止までのstateを示す。
  - kind: mapping
    path: docs/architecture/meeting-review-package-ingest-architecture.md
    purpose: Review Packageの各sectionがworkflow_outputsへどう写るかを示す。
---

# Meeting Review Package Ingest v1 Spec

## API Contract

`POST /api/workflows/control/meeting-pack/review-ingest`

Success status: `201 Created`

Validation failures that prevent ingest writes return `400` with `state_transition` and `details`. Authorization failures return `403` and do not write ingest records.

Request body:

```json
{
  "org_id": "tech-knight",
  "project_id": "tech-knight",
  "case_scope": "hotel-dx-united",
  "review_package": {
    "schema_version": "0.1.0",
    "package_id": "meeting-review-package-2026-06-25-rabuhoteru-marketing",
    "status": "review_required",
    "meeting_identity": {},
    "source_event": {},
    "loop_intent_ids": {},
    "meeting_note_summary": {},
    "task_candidates": [],
    "decision_candidates": [],
    "follow_up_draft": {},
    "promotion_candidates": {},
    "evidence_refs": [],
    "stop_conditions": []
  }
}
```

Response body:

```json
{
  "meeting_review_ingest": {
    "org_id": "tech-knight",
    "project_id": "tech-knight",
    "case_scope": "hotel-dx-united",
    "package_id": "meeting-review-package-2026-06-25-rabuhoteru-marketing",
    "idempotent": false,
    "state_transitions": [
      "package_received",
      "scope_resolved",
      "loop_intents_verified",
      "run_recorded",
      "outputs_recorded",
      "human_steps_recorded",
      "waiting_human"
    ],
    "run": {},
    "outputs": [],
    "human_steps": [],
    "context_snapshots": [],
    "loop_intents": []
  }
}
```

## Invariants

- INV-001: Review Package ingest は Eve 実行ではなく、`runner.type=codex_generated_package` として記録する。
- INV-002: API は local file path を読まない。入力は JSON payload として受け取る。
- INV-003: `org_id` / `project_id` は明示入力を優先し、なければ `meeting_identity.candidate_org_id` / `candidate_project_id` を使う。
- INV-004: `loop_intent_ids` は必要keyが揃っていることを確認し、書き込み前に既存 `loop_intents` と照合する。
- INV-005: project mismatch、org mismatch、missing loop intent がある場合は `workflow_runs`、`workflow_outputs`、`workflow_human_steps`、`workflow_audit_logs` を作らない。
- INV-006: output payload key が欠落している場合は `blocked_invalid_review_package` として書き込み前に拒否する。
- INV-007: 取り込み run は必ず `waiting_human` で止まり、外部副作用は実行しない。
- INV-008: Output は `requires_human_approval=true` と `evidence_refs` を持つ。
- INV-009: 同じ `package_id + org_id + project_id` の再取り込みは冪等で、既存 run を返す。
- INV-010: Graph SSOT / Task Store / 外部送信 / Learning promotion はこの Story では候補の保存までで止める。
- INV-011: 1件の human step 承認では review run を閉じず、残り pending step を `/workflows` の最新承認待ちとして維持する。全 human step 承認後だけ `success/closed` にする。
- INV-012: Package由来の Graph context は `candidate_from_review_package` として記録し、Graph SSOT昇格済み正本とは区別する。
- INV-013: v1のrelease/rollback境界はBrainbase内部の候補取り込みに限定し、Task/Graph/外部送信の副作用rollbackを必要とする処理は実行しない。
- INV-014: Support時にoperatorが確認する証跡は `package_id`、`case_scope`、`runner.type`、`meeting_source.content_hash`、pending human step数、audit actionである。
- INV-015: `meeting-review-package-ingest` workflow は汎用manual run / rerunでは実行できず、Review Packageなしの `success/closed` runを作らない。
- INV-016: いずれかの Review Package human step がRejectされた場合、runは `cancelled/closed` で停止し、残りのpending stepは `cancelled` になり、後続Approveで `success/closed` に戻らない。

## Scenarios

- S-001: Operator ingests a valid Codex-generated Review Package, and Brainbase creates one waiting-human run through `review-ingest`.
- S-002: Missing or cross-project Loop Intent fails before run/output/human step/audit writes.
- S-003: Re-ingesting the same `package_id + org_id + project_id` returns the existing run without duplicate outputs or human steps.
- S-004: Manual run or rerun of a review-ingest workflow fails before creating extra run/output/human step records.
- S-005: Ingest with a missing output payload key fails before writes.
- S-006: UnitedホテルDXの実案件fixtureを取り込み、同じ5 output / 5 human step / context / audit smokeを再実行できる。
- S-007: `/workflows` Mission Control shows the Review Package run as `waiting_human` with visible approval actions.
- S-008: Resolving one generated approval leaves the run waiting for the remaining approvals, and resolving all approvals closes the run.
- S-009: Rejecting one generated approval cancels the Review Package run and remaining pending approvals, and stale approvals cannot reopen or succeed the run.

## Field Mapping

| Review Package | Brainbase target |
|---|---|
| `package_id` | `workflow_runs.metadata.package_id`, output metadata, audit log |
| `meeting_identity` | context snapshot + run metadata |
| `source_event` | context snapshot + run metadata |
| `loop_intent_ids.transcript_to_meeting_note` | meeting note output metadata |
| `loop_intent_ids.meeting_note_to_tasks` | task candidates output metadata |
| `loop_intent_ids.meeting_note_to_decisions` | decision candidates output metadata |
| `loop_intent_ids.post_meeting_follow_up_message` | follow-up output metadata |
| `meeting_note_summary` | `workflow_outputs.type=meeting_note_draft` |
| `task_candidates` | `workflow_outputs.type=task_candidates` |
| `decision_candidates` | `workflow_outputs.type=decision_candidates` |
| `follow_up_draft` | `workflow_outputs.type=message_draft` |
| `promotion_candidates` | `workflow_outputs.type=promotion_candidates` |
| `evidence_refs` | output metadata + audit log |
| `stop_conditions` | run metadata + audit log |

## Acceptance Tests

- `tests/server/routes/workflows.test.js`
  - valid Review Package ingest creates waiting-human run, five outputs, five human steps, context snapshots, and audit log.
  - Mission Control list response exposes `latest_run.status=waiting_human`, `action_required=approve`, `human_waiting=true`, and five latest human steps.
  - repeated ingest returns idempotent result and does not duplicate run/output/human step records.
  - missing Loop Intent returns 400 and writes no run/output/human step records.
  - missing required Loop Intent key or output payload key returns 400 with blocked state details and writes no run/output/human step records.
  - missing package id, invalid scope, or malformed `loop_intent_ids` returns structured blocked state details.
  - resolving one generated human approval keeps the original review run visible with the remaining pending human steps.
  - rejecting one generated human approval cancels the original review run, cancels the remaining pending human steps, and rejects stale approval attempts.
  - manual run and rerun of the generated review-ingest workflow return 400 and do not create extra run/output/human step records.

- `tests/server/services/workflow-org-agent-control.test.js`
  - service-level ingest resolves scope from `meeting_identity.candidate_*`.
  - service-level ingest rejects loop intent project mismatch before writes.
  - service-level ingest rejects missing required Loop Intent key and missing output payload key before writes.
  - service-level human step resolution keeps the review run waiting until all generated approvals are resolved.
  - service-level human rejection cancels the remaining review gates and prevents stale approvals from succeeding the run.
  - service-level manual run and rerun of the generated review-ingest workflow fail before extra run writes.
  - service-level ingest rolls back partial writes when persistence fails mid-transaction.

- `tests/e2e/story-meeting-review-package-ingest-v1-contract.spec.ts`
  - S-001/S-003/AC1-AC11 contract checks cover package scope, context hash, output/human step mapping, idempotency, audit, and Eve-not-connected metadata.
  - S-005 missing output payload key fails before run/output/human step/audit writes.
  - S-008 approval progression keeps the run waiting until all approvals are resolved.
  - S-009 rejection progression prevents a rejected Review Package run from returning to success.
  - S-004/S-014 manual run/rerun cannot bypass the Review Package ingest contract.
  - S-006 UnitedホテルDX fixture smoke checks 5 outputs, 5 human steps, context hash, and audit.
  - S-007 `/workflows` Mission Control UI smoke shows the Review Package run as `waiting_human` with approval buttons and no generic Run/Rerun controls for Review Package-only execution.
  - `tests/fixtures/meeting-review-package-united-hotel-dx.json` replays the Tech Knight / UnitedホテルDX package smoke.

## Operational Verification

- Release note: Eve未接続、Codex生成Packageの候補取り込み、外部write-backなし、承認待ちrunが `/workflows` に出ることを明示する。
- Rollback instruction: v1は外部副作用を起こさないため、誤Packageは対象runを無効化または別package_idで再取り込みし、Task/Graph/外部送信の取り消し作業は不要である。
- Observability evidence: run metadata、context snapshot content hash、pending human step数、audit actionをoperator-visible evidenceとして確認する。

## Anti-Patterns

- AP-001: Treating Codex-generated package as Eve execution evidence.
- AP-002: Writing tasks, decisions, Graph records, or external messages during ingest.
- AP-003: Parsing Markdown when JSON Review Package is available.
- AP-004: Creating one-off tables outside Workflow Mission Control.
- AP-005: Ignoring Loop Intent mismatch and silently accepting stale project identity.
