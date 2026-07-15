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
- `run.metrics`: finite number, boolean, or null values only
- `run.evidence_refs[]`: `{ kind, ref, label? }`
- `delivery.attempt`, `delivery.sent_at`

## Invariants

- Canonical identity bytes are UTF-8 JSON of `[run.project_id, source.type, run.external_run_id]` with no whitespace. `delivery.idempotency_key` must equal `rr1_` plus the lowercase SHA-256 hex digest of those bytes.
- WMC run id is `run_receipt_run_` plus the first 32 characters of that digest. WMC workflow id is `run_receipt_wf_` plus the first 32 characters of SHA-256 over UTF-8 JSON `[run.project_id, source.type, source.workflow_id]`.
- `failed` and `blocked` require `run.blocker_reason` or non-`none` `run.action_required`.
- `evidence_state=confirmed` requires at least one evidence reference.
- The forbidden key set `content|body|raw_log|rawLog|transcript|customer_text|customerText|payload` is rejected recursively anywhere in the envelope.
- `source.workflow_id` and every identity field are non-empty strings of at most 200 characters. Optional `source.name`, `source.runtime_target`, and `run.workflow_name` are single-line operational labels of at most 120 characters.
- `run.summary` is a connector-redacted, single-line operational summary of at most 500 characters. `run.blocker_reason` is a connector-redacted, single-line operational reason of at most 300 characters. They must not contain customer prose, secrets, raw logs, or transcripts; the source connector owns redaction before delivery and Brainbase rejects control characters, line breaks, forbidden keys, and oversize values as defense in depth.
- `run.action_required` is one of `none | check_error | resolve_blocker | review_run | retry_run | reauthorize | contact_owner`; connector-specific prose is not accepted in this field.
- Metric names are single-line operational identifiers of at most 120 characters. Metric values must be finite number, boolean, or null; strings, nested objects/arrays, and content/log/transcript-like metric names are rejected.
- Every evidence reference has `kind=url|artifact_ref|log_ref`, a non-empty `ref` of at most 2048 characters, and an optional single-line `label` of at most 120 characters. `url` accepts only an absolute `https:` URL. `artifact_ref` and `log_ref` require a source-owned opaque URI-like reference matching `^[a-z][a-z0-9+.-]{1,31}:[^\\s]{1,2000}$`; embedded credentials and empty/broken refs are rejected.
- `finished_at` may not precede `started_at`.
- Receipt delivery metadata never changes source `run.status`.
- `connector_observation` requires `source.workflow_id=__connector_observation__`, `run.status=blocked`, `run.evidence_state=no_data|unconfirmed`, and `run.blocker_reason`. Its external run id names a connector-owned observation attempt, not a source run.
- Ingest requires a repository transaction capability. Validation, workflow, run, and audit persistence are atomic; unsupported repositories fail before writes.
- Before duplicate lookup, ingest acquires a receipt lock scoped by `run.project_id + deterministic run id`. Lock acquisition uses the repository lock capability with bounded retry; duplicate lookup and the transaction execute while held, and release happens in `finally`. A repository without transaction/acquire/release capability fails before writes. Concurrent identical receipts therefore produce one `created` and remaining `duplicate` responses, while lock timeout produces no mutation.
- Duplicate equality uses a normalized immutable projection containing `contract_version`, normalized `source`, and normalized `run` fields. `delivery` is excluded in full, including `attempt` and `sent_at`; identity is already enforced by the canonical tuple/key check. Object keys are recursively sorted, absent optional fields are omitted, timestamps use their validated input strings, evidence references are sorted by `kind`, `ref`, then `label`, and metrics are sorted by key. SHA-256 over UTF-8 compact JSON of this projection is stored as `payload_digest`. A retry that changes only delivery metadata is a duplicate; any immutable projection change is `run_receipt_conflict`.

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
- S-006a `workflow retry matrix`: a retry changing only `delivery.attempt` or `delivery.sent_at` is duplicate; reordered metric keys or evidence refs normalize to the same digest.
- S-006b `workflow retry matrix`: simultaneous identical receipts serialize under one receipt lock and yield one created run plus duplicate responses, never multiple runs.
- S-007 `workflow rollback guard`: same idempotency identity with different normalized content is rejected without mutation.
- S-008 `workflow rollback guard`: invalid evidence, project mismatch, or unsupported source/status is rejected before writes.
- S-009 `inbox priority`: blocked or source-supplied action, failed, waiting-human, unconfirmed, no-data, confirmed order is stable; adapter defaults alone do not promote priority.
- S-010 `inbox filter`: source, project, run status, and evidence state filters compose without treating unavailable as zero.
- S-011 `workflow auth boundary`: POST cookie/session-only ingest and inaccessible projects are rejected; authenticated operator GET is allowed and project-scoped.
- S-011a `workflow auth boundary`: production CSRF bypass applies only when `req.method === 'POST' && req.path === '/api/run-receipts/ingest'`; bearer/service/internal clients reach route auth, cookie/session-only POST is rejected there, `PUT`/`PATCH`/`DELETE` for that same path remain production-CSRF `403`, and existing external-runner/companion/internal-key exemptions remain unchanged.
- S-012 `compatibility guard`: `external_runner.v0` ingest behavior and tests remain unchanged.
- S-013 `connector observation`: source-unavailable fallback remains visible as a connector observation and is never counted as a source run failure or empty success.
- S-014 `operator surface`: Workflow Mission Control UI renders source status, uncertainty warning, blocker/action, evidence refs and composed filters in the same order as the API.
- S-015 `shared ledger regression`: receipt workflows remain in the shared repository but are excluded from `GET /api/workflows` and the existing Operational Inbox, so a receipt appears exactly once in Agent Run Inbox. In a receipt + non-receipt mixed fixture, non-receipt membership, priority, and rendering remain unchanged.
- S-016 `receipt surface failure isolation`: timeout, network failure, or 5xx from `GET /api/run-receipts/inbox` leaves the existing Workflow page and Operational Inbox usable, renders an explicit unavailable warning only in Agent Run Inbox, and never reports that failure as empty items or zero receipts.

## API

- `POST /api/run-receipts/ingest`
  - 201 `{ status: "created", run, workflow, audit_logs }`
  - 200 `{ status: "duplicate", run, workflow, audit_logs }`
  - 400 contract/conflict error
  - 403 auth/project error
- `GET /api/run-receipts/inbox`
  - filters: `project_id`, `source_type`, `run_status`, `evidence_state`, `limit`
  - response: `{ items, count, has_more, omitted_count }`
  - repository/service failures return an explicit non-2xx error; they are not converted to a successful empty response

## Verification

- AC1/AC4/AC6/AC8: `tests/server/services/run-receipt-contract.test.js` rejects pre-fix invalid status/evidence, raw-key bypasses, oversized text, nested metrics, and delivery/status conflation.
- AC2/AC3/AC9: `tests/server/services/run-receipt-ingest-service.test.js` proves tuple hashing, cross-project/source separation, delivery-only and reordered-field duplicate no-op, conflict rollback, concurrent one-create/many-duplicate behavior, lock timeout rollback, source status preservation, workflow collision guard, and required transaction/lock capability.
- AC4/AC5: `tests/server/services/run-receipt-inbox.test.js` uses fixtures for all six reachable priority buckets, composed filters, connector observation, omitted count, and uncertainty preservation.
- AC7/AC10: `tests/server/routes/run-receipt-routes.test.js` and `tests/unit/csrf-run-receipt-ingest-exempt.test.js` prove the pre-fix production behavior first (POST/PUT/PATCH/DELETE on the ingest path are all `403`), then prove the implementation changes only the exact `POST /api/run-receipts/ingest` predicate so it reaches route auth while same-path PUT/PATCH/DELETE and near-match POST paths such as `/api/run-receipts/ingest/extra` and `/api/run-receipts/ingest-legacy` remain `403`; they also prove POST server-to-server/project denial, cookie/session-only rejection, GET operator/project-scope behavior, and unchanged existing exemptions. This fixture must fail any prefix-based exemption such as `startsWith('/api/run-receipts/ingest')`.
- AC5/AC11: `tests/ui/run-receipt-inbox.test.js` and workflow service/route tests use a receipt + non-receipt mixed fixture to prove visible no_data/unconfirmed warnings, source/status/evidence filters, evidence links, API ordering, exactly-once receipt rendering, exclusion from `GET /api/workflows` and Operational Inbox, and unchanged non-receipt priority/rendering.
- AC12/S-016: `tests/ui/run-receipt-inbox.test.js` injects timeout, network, and 5xx receipt-API failures and proves the existing Workflow page/Operational Inbox stays rendered while only Agent Run Inbox shows unavailable; route tests prove repository/service errors are explicit non-2xx responses and never `{ items: [], count: 0 }` success.
- S-012/S-015: existing external runner, workflow service, workflow route, and Workflow Mission Control UI tests remain green.
