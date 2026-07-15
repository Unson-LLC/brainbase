# Cross-runtime Run Receipt Inbox v1 Spec

## Contract

`run_receipt.v1` is the generic operational result envelope for source-owned jobs observed by Brainbase.

## Required Fields

- `contract_version`: `run_receipt.v1`
- `source.type`: `mana | codex_automations | github_actions | salestailor`
- `source.workflow_id`
- `run.project_id`
- `run.external_run_id`
- `run.status`: `success | failed | blocked | waiting_human | cancelled`
- `run.evidence_state`: `confirmed | unconfirmed | no_data`
- `run.started_at` or `run.finished_at`
- `delivery.idempotency_key`

## Optional Fields

- `source.name`, `source.runtime_target`
- `run.org_id`, `run.workflow_name`, `run.parent_external_run_id`
- `run.finished_at`, `run.summary`, `run.blocker_reason`, `run.action_required`
- `run.metrics`: scalar JSON values only
- `run.evidence_refs[]`: `{ kind, ref, label? }`
- `delivery.attempt`, `delivery.sent_at`

## Invariants

- `delivery.idempotency_key` must equal the canonical key derived from `run.project_id + source.type + run.external_run_id`.
- `failed` and `blocked` require `run.blocker_reason` or non-`none` `run.action_required`.
- `evidence_state=confirmed` requires at least one evidence reference.
- Evidence refs may point to source artifacts but may not contain inline `content`, `body`, `raw_log`, or `transcript`.
- `metrics` values must be string, number, boolean, or null; nested source payloads are rejected.
- `finished_at` may not precede `started_at`.
- Receipt delivery metadata never changes source `run.status`.

## Mapping

| Contract field | Brainbase surface |
|---|---|
| `source.workflow_id` | project/source-scoped `workflows.id` |
| project + source type + external run id | deterministic `workflow_runs.id` |
| `run.status` | WMC status/closure/action mapping |
| `run.evidence_state` | `workflow_runs.metadata.run_receipt.evidence_state` |
| `run.metrics` | `workflow_runs.metadata.run_receipt.metrics` |
| `run.evidence_refs[]` | run metadata plus redacted audit reference summary |
| delivery metadata | `workflow_runs.metadata.run_receipt.delivery` |

## Scenario Clauses

- S-001 `workflow state transition`: confirmed success maps to `success / closed / none` and is present in receipt listing.
- S-002 `workflow state transition`: failed maps to `failed / needs_action / check_error` without changing `evidence_state`.
- S-003 `workflow state transition`: blocked maps to `needs_action / needs_action / resolve_blocker`.
- S-004 `workflow state transition`: waiting human maps to `waiting_human / open / review_run` unless an explicit action is supplied.
- S-005 `workflow state transition`: cancelled remains cancelled and is not counted as success.
- S-006 `workflow retry matrix`: exact duplicate returns the original run and writes no second run.
- S-007 `workflow rollback guard`: same idempotency identity with different normalized content is rejected without mutation.
- S-008 `workflow rollback guard`: invalid evidence, project mismatch, or unsupported source/status is rejected before writes.
- S-009 `inbox priority`: blocked/action-required, failed, waiting-human, unconfirmed, no-data, confirmed order is stable.
- S-010 `inbox filter`: source, project, run status, and evidence state filters compose without treating unavailable as zero.
- S-011 `workflow auth boundary`: cookie-only requests and inaccessible projects are rejected.
- S-012 `compatibility guard`: `external_runner.v0` ingest behavior and tests remain unchanged.

## API

- `POST /api/run-receipts/ingest`
  - 201 `{ status: "created", run, workflow, audit_logs }`
  - 200 `{ status: "duplicate", run, workflow, audit_logs }`
  - 400 contract/conflict error
  - 403 auth/project error
- `GET /api/run-receipts/inbox`
  - filters: `project_id`, `source_type`, `run_status`, `evidence_state`, `limit`
  - response: `{ items, count, has_more, omitted_count }`

## Verification

- `tests/server/services/run-receipt-contract.test.js`
- `tests/server/services/run-receipt-ingest-service.test.js`
- `tests/server/services/run-receipt-inbox.test.js`
- `tests/server/routes/run-receipt-routes.test.js`
- existing external runner and workflow service tests
