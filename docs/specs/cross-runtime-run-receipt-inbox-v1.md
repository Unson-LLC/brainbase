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
- Timestamp ordering parses every validated RFC 3339 value into a UTC epoch millisecond. Latest selection and final listing never compare offset-bearing timestamp strings lexicographically. Final listing order is priority ascending, effective epoch descending, persisted-created epoch descending, deterministic run id descending.
- Receipt delivery metadata never changes source `run.status`.
- `connector_observation` requires `source.workflow_id=__connector_observation__`, `run.status=blocked`, `run.evidence_state=no_data|unconfirmed`, and `run.blocker_reason`. Its external run id names a connector-owned observation attempt, not a source run.
- Ingest requires a repository transaction capability. Every repository serializes unrelated transaction owners through an in-process queue and carries the current owner in `AsyncLocalStorage`. A nested transaction from that same async owner joins the outer transaction without reacquiring the queue/file lease or taking a second snapshot. Only the outermost transaction reloads, commits, or restores. Any nested failure marks the outer owner rollback-only, so a caught inner failure cannot commit partial state. Unsupported repositories fail before writes.
- The JSON repository additionally acquires a file-wide transaction lease with bounded retry, reloads only under that lease, defers intermediate persistence, and commits once. It never steals a live lease; stale recovery requires both an expired lease and proof that the recorded local PID is absent. A failed transaction restores only process memory and never persists its stale snapshot. Lease release always occurs in `finally`.
- Every JsonFile shared-ledger collection mutation primitive rejects calls without an active transaction owner before changing memory. Receipt/workflow identity locks and transaction lease metadata are separately synchronized control-plane state outside `workflow-ledger.json`; they are exempt from the collection guard, and acquire/release never reloads or replaces shared-ledger memory. InMemory identity locks are likewise outside the ledger snapshot. WorkflowService, WorkflowRunner, external_runner create and duplicate replay, reconciler, and every other production shared-ledger writer use short repository transaction callbacks around atomic persistence groups. Remote handler execution, network I/O, long sleeps, and human waits do not occur while the file lease is held.
- JsonFile seed workflows are inserted before repository publication by a dedicated initialization transaction using the same owner context, file lease, under-lease reload, single commit, and `finally` release. Only missing seeds are inserted; existing ledger content is preserved. Runtime default-workflow repair uses the normal reentrant transaction.
- `external_runner.v0` commits core run state plus deterministic pending-candidate audit intents in one short transaction, performs idempotent Candidate Store writes outside the lease, and finalizes each intent as stored or deferred in another short transaction. Exact replay resumes pending intents without duplicate-replay audit; a converged replay is write-free. Interruption at each boundary is recoverable by deterministic candidate id.
- Before duplicate lookup, ingest acquires a receipt identity lock scoped by `run.project_id + deterministic run id`, then enters the repository-wide write transaction. Duplicate lookup, conflict comparison, and persistence execute inside both boundaries, and receipt lock release happens in `finally`. Lock ordering is receipt identity then shared-ledger transaction; shared-ledger transaction code never acquires a receipt identity lock. A repository without transaction/acquire/release capability, or either bounded lock timeout, fails before writes. Identical receipts produce one `created` and remaining `duplicate`; distinct receipts and all production writers preserve every committed workflow, run, step, and audit.
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
- S-017 `latest run selection`: receipt history is collapsed by `(project_id, source.type, source.workflow_id)` before filters, priority, count, and limit. Selection uses greatest `finished_at || started_at || created_at`, then greatest persisted `created_at`, then lexicographically greatest deterministic run id. An old blocked run followed by a new success yields only the success; a blocked-status filter does not resurrect the old run; different workflow identities remain independently visible.
- S-018 `total order`: collapsed identities with equal priority are ordered by effective UTC epoch, persisted-created UTC epoch, then deterministic run id, all descending except priority. Equivalent instants with different RFC 3339 offsets compare equal before the later tie-breaks, and repeated limit queries return the same items.
- S-019 `browser architecture`: receipt HTTP access and shape validation live in a dedicated client; a DI-composed service updates the Reactive Store and emits loaded/failed EventBus events; `public/workflows.html` only subscribes/renders and a receipt failure never mutates the existing workflow state.
- S-020 `shared ledger transaction`: concurrent distinct receipt identities preserve both projections; receipt ingest racing `external_runner.v0` create or duplicate replay and WorkflowService/WorkflowRunner mutation preserves every workflow, run, step, and audit; a failed JSON transaction cannot write its rollback snapshot over another committed transaction; same-owner nested calendar-to-meeting-pack transactions complete without deadlock, propagate rollback-only, and unrelated owners remain serialized; shared-ledger collection mutation outside a transaction is rejected before memory or disk changes; identity-lock operations cannot reload pending memory; startup seed initialization preserves concurrent existing content; a blocked remote handler does not hold the lease; candidate outbox interruption resumes idempotently.

## API

- `POST /api/run-receipts/ingest`
  - 201 `{ status: "created", run, workflow, audit_logs }`
  - 200 `{ status: "duplicate", run, workflow, audit_logs }`
  - 400 contract/conflict error
  - 403 auth/project error
- `GET /api/run-receipts/inbox`
  - filters: `project_id`, `source_type`, `run_status`, `evidence_state`, `limit`
  - response: `{ items, count, has_more, omitted_count }`
  - selection/pagination: collapse to the latest run per workflow identity, then apply all filters and the total order priority asc → effective UTC epoch desc → persisted-created UTC epoch desc → deterministic run id desc; `count` is the matching collapsed total before `limit`, `has_more = count > items.length`, and `omitted_count = count - items.length`
  - repository/service failures return an explicit non-2xx error; they are not converted to a successful empty response

## Verification

- AC1/AC4/AC6/AC8: `tests/server/services/run-receipt-contract.test.js` rejects pre-fix invalid status/evidence, raw-key bypasses, oversized text, nested metrics, and delivery/status conflation.
- AC2/AC3/AC9/AC15: `tests/server/services/run-receipt-ingest-service.test.js` proves tuple hashing, cross-project/source separation, delivery-only and reordered-field duplicate no-op, conflict rollback, concurrent one-create/many-duplicate behavior, lock timeout rollback, source status preservation, workflow collision guard, required transaction/lock capability, concurrent distinct identity preservation, receipt versus `external_runner.v0` create and duplicate replay preservation, and receipt versus WorkflowRunner mutation preservation. `tests/server/services/workflow-repository-transaction.test.js` proves failed JSON rollback never overwrites another committed writer, same-owner nesting completes without reacquiring the lease, caught inner failure makes the outer transaction rollback-only, unrelated owners serialize, stale live leases are not stolen, expired dead-owner leases recover, out-of-transaction shared-ledger mutation is rejected before memory/disk change, identity-lock acquire/release cannot replace pending ledger memory, and pre-publication seed initialization preserves existing content. `tests/server/services/workflow-org-agent-control.test.js` timeout-bounds the existing calendar-to-meeting-pack nested path and retains its all-collection rollback assertion. `tests/server/services/workflow-runner.test.js` blocks a fake handler and proves an unrelated transaction commits before handler release. `tests/server/services/external-runner-ingest-service.test.js` interrupts pending, Candidate Store success, and final-audit phases and proves idempotent resume plus converged duplicate no-op. `tests/server/services/eve-meeting-note-reconciler.test.js` covers every update/audit branch under the transaction guard.
- AC4/AC5/AC13/AC14: `tests/server/services/run-receipt-inbox.test.js` uses fixtures for all six reachable priority buckets, composed filters, connector observation, omitted count, uncertainty preservation, and latest-run collapse. Pre-fix fixtures prove old blocked + new success returns only the success, blocked filtering does not resurrect old history, a separate workflow remains visible, equal instants written with different offsets use the persisted-created-at/run-id tie-break, full cross-identity order is total, repeated limited queries are stable, and count/has_more/omitted_count are computed after collapse and filters.
- AC7/AC10: `tests/server/routes/run-receipt-routes.test.js` and `tests/unit/csrf-run-receipt-ingest-exempt.test.js` prove the pre-fix production behavior first (POST/PUT/PATCH/DELETE on the ingest path are all `403`), then prove the implementation changes only the exact `POST /api/run-receipts/ingest` predicate so it reaches route auth while same-path PUT/PATCH/DELETE and near-match POST paths such as `/api/run-receipts/ingest/extra` and `/api/run-receipts/ingest-legacy` remain `403`; they also prove POST server-to-server/project denial, cookie/session-only rejection, GET operator/project-scope behavior, and unchanged existing exemptions. This fixture must fail any prefix-based exemption such as `startsWith('/api/run-receipts/ingest')`.
- AC5/AC11: `tests/ui/run-receipt-inbox.test.js` and workflow service/route tests use a receipt + non-receipt mixed fixture to prove visible no_data/unconfirmed warnings, source/status/evidence filters, evidence links, API ordering, exactly-once receipt rendering, exclusion from `GET /api/workflows` and Operational Inbox, and unchanged non-receipt priority/rendering.
- AC12/AC14/S-016/S-019: `tests/ui/run-receipt-inbox.test.js` injects timeout, network, and 5xx receipt-API failures and proves the dedicated client/service updates `appStore.runReceiptInbox`, emits the matching loaded/failed EventBus event, leaves existing Workflow page/Operational Inbox state rendered, and shows unavailable only in Agent Run Inbox; route tests prove repository/service errors are explicit non-2xx responses and never `{ items: [], count: 0 }` success.
- S-012/S-015: existing external runner, workflow service, workflow route, and Workflow Mission Control UI tests remain green.
