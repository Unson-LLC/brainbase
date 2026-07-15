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
- `run.observation_kind`: `source_run | connector_observation` (default: `source_run`)
- `run.metrics`: scalar JSON values only
- `run.evidence_refs[]`: `{ kind, ref, label? }`
- `delivery.attempt`, `delivery.sent_at`

## Invariants

- Canonical identity bytes are UTF-8 JSON of `[run.project_id, source.type, run.external_run_id]` with no whitespace. `delivery.idempotency_key` must equal `rr1_` plus the lowercase SHA-256 hex digest of those bytes.
- WMC run id is `run_receipt_run_` plus the first 32 characters of that digest. WMC workflow id is `run_receipt_wf_` plus the first 32 characters of SHA-256 over UTF-8 JSON `[run.project_id, source.type, source.workflow_id]`.
- `failed` and `blocked` require `run.blocker_reason` or non-`none` `run.action_required`.
- `evidence_state=confirmed` requires at least one evidence reference.
- The forbidden key set `content|body|raw_log|rawLog|transcript|customer_text|customerText|payload` is rejected recursively anywhere in the envelope.
- `run.summary` is at most 500 characters. Evidence labels, metric names, and string metric values are at most 200 characters.
- `metrics` values must be string, finite number, boolean, or null; nested source payloads and content/log/transcript-like metric names are rejected.
- `finished_at` may not precede `started_at`.
- Receipt delivery metadata never changes source `run.status`.
- `connector_observation` requires `source.workflow_id=__connector_observation__`, `run.status=blocked`, `run.evidence_state=no_data|unconfirmed`, and `run.blocker_reason`. Its external run id names a connector-owned observation attempt, not a source run.
- Ingest requires a repository transaction capability. Validation, workflow, run, and audit persistence are atomic; unsupported repositories fail before writes.

## Mapping

| Contract field | Brainbase surface |
|---|---|
| project + source type + source workflow id | hashed internal `workflows.id`; original id in metadata |
| project + source type + external run id | deterministic `workflow_runs.id` |
| `run.status` | `workflow_runs.metadata.run_receipt.source_status` plus WMC status/closure/action projection |
| `run.evidence_state` | `workflow_runs.metadata.run_receipt.evidence_state` |
| `run.metrics` | `workflow_runs.metadata.run_receipt.metrics` |
| `run.evidence_refs[]` | run metadata plus redacted audit reference summary |
| delivery metadata | `workflow_runs.metadata.run_receipt.delivery` |
| source-supplied action presence | `workflow_runs.metadata.run_receipt.source_action_required` |

## Scenario Clauses

- S-001 `workflow state transition`: confirmed success maps to `success / closed / none` and is present in receipt listing.
- S-002 `workflow state transition`: failed maps to `failed / needs_action / check_error` without changing `evidence_state`.
- S-003 `workflow state transition`: blocked maps to `needs_action / needs_action / resolve_blocker`.
- S-004 `workflow state transition`: waiting human maps to `waiting_human / open / review_run` unless an explicit action is supplied.
- S-005 `workflow state transition`: cancelled remains cancelled and is not counted as success.
- S-006 `workflow retry matrix`: exact duplicate returns the original run and writes no second run.
- S-007 `workflow rollback guard`: same idempotency identity with different normalized content is rejected without mutation.
- S-008 `workflow rollback guard`: invalid evidence, project mismatch, or unsupported source/status is rejected before writes.
- S-009 `inbox priority`: blocked or source-supplied action, failed, waiting-human, unconfirmed, no-data, confirmed order is stable; adapter defaults alone do not promote priority.
- S-010 `inbox filter`: source, project, run status, and evidence state filters compose without treating unavailable as zero.
- S-011 `workflow auth boundary`: POST cookie/session-only ingest and inaccessible projects are rejected; authenticated operator GET is allowed and project-scoped.
- S-012 `compatibility guard`: `external_runner.v0` ingest behavior and tests remain unchanged.
- S-013 `connector observation`: source-unavailable fallback remains visible as a connector observation and is never counted as a source run failure or empty success.
- S-014 `operator surface`: Workflow Mission Control UI renders source status, uncertainty warning, blocker/action, evidence refs and composed filters in the same order as the API.
- S-015 `shared ledger regression`: non-receipt workflows and existing Operational Inbox priority/rendering remain unchanged.

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

- AC1/AC4/AC6/AC8: `tests/server/services/run-receipt-contract.test.js` rejects pre-fix invalid status/evidence, raw-key bypasses, oversized text, nested metrics, and delivery/status conflation.
- AC2/AC3: `tests/server/services/run-receipt-ingest-service.test.js` proves tuple hashing, cross-project/source separation, exact duplicate no-op, conflict rollback, source status preservation, workflow collision guard, and required transaction capability.
- AC4/AC5: `tests/server/services/run-receipt-inbox.test.js` uses fixtures for all six reachable priority buckets, composed filters, connector observation, omitted count, and uncertainty preservation.
- AC7: `tests/server/routes/run-receipt-routes.test.js` proves POST server-to-server/project denial and GET operator/project-scope behavior.
- AC5: `tests/ui/run-receipt-inbox.test.js` proves visible no_data/unconfirmed warnings, source/status/evidence filters, evidence links, API ordering, and unchanged non-receipt Operational Inbox behavior.
- S-012/S-015: existing external runner, workflow service, workflow route, and Workflow Mission Control UI tests remain green.
