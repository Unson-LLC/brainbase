# Run Receipt Inbox v1 Release and Rollback Runbook

## Owner and Authority

- Release owner: Brainbase operator.
- Brainbase owns contract validation, idempotent ledger projection, Inbox ordering, and explicit unavailable state.
- Mana, Codex Automations, GitHub Actions, and SalesTailor remain authoritative for source execution, delivery outbox/retry, credentials, and raw logs.
- Owner-visible evidence is the Agent Run Inbox status plus source-owned `evidence_refs`; auth, timeout, or source failure must never be reported as zero or success.

## Rollout Plan

1. Deploy the additive `run_receipt.v1` ingest and Inbox API with receipt records excluded from all legacy workflow/run mutation surfaces.
2. Deploy Agent Run Inbox and verify existing Operational Inbox membership and priority are unchanged.
3. Enable one connector canary at a time: Mana, Codex Automations, GitHub Actions, then SalesTailor.
4. For each source, submit one confirmed terminal run, one terminal run with `unconfirmed|no_data`, one blocked/failed run, and one exact redelivery.
5. Promote a connector only after exactly one Inbox item is visible per workflow identity, source/evidence/action fields match the source, and duplicate delivery creates no second run or audit.

The common control plane has no destructive migration and no release-time backfill. Existing Workflow Mission Control data remains readable throughout version skew.

## Observability Evidence

- Ingest: HTTP 201 means created, HTTP 200 means an exact duplicate, HTTP 400 means contract/conflict, HTTP 403 means auth/project denial, and HTTP 503 with `Retry-After` means receipt-lock contention.
- Inbox: `unavailable` is distinct from a ready empty result; the last confirmed items and filters remain visible. The browser aborts a stalled Inbox request after 10 seconds and applies the same unavailable/snapshot-retention path as network and 5xx failures.
- Audit: created receipts include redacted metadata and source-owned references only. Raw logs, customer prose, payload bodies, transcripts, and secrets are forbidden.
- Release canary: capture the source run URL/artifact ref, ingest response status, deterministic Brainbase run id, Agent Run Inbox screenshot, and duplicate replay result.
- Alert condition: any legacy workflow/run API exposes a receipt, Operational Inbox contains a receipt, non-receipt priority changes, or an unavailable source is rendered as zero/success.

## Rollback Instruction

1. Disable connector delivery first so source-owned outboxes retain pending receipts.
2. Revert the Agent Run Inbox UI and receipt routes together if the common surface is unhealthy.
3. Preserve already-written receipt workflows/runs/audits. Do not delete or rewrite the shared ledger during rollback.
4. Keep receipt rows excluded from generic workflow/run APIs and Operational Inbox even while the dedicated UI is disabled.
5. After recovery, replay connector outboxes with the same idempotency keys; exact replay must return duplicate.

## Feature Gate Disabled Behavior

Connector delivery is the rollout gate. When a connector is disabled, source execution continues and its source-owned outbox remains pending; Brainbase must not synthesize success, zero metrics, or a source run. If source identity is unavailable, a separately identified connector observation may be sent only under the contract rules.

## Upgrade / Downgrade Test

- Upgrade: an existing non-receipt workflow plus new receipt coexist; the receipt appears once in Agent Run Inbox and nowhere in legacy/Operational surfaces.
- Downgrade: disable connector delivery and dedicated UI/routes while preserving receipt ledger rows; existing non-receipt workflow APIs and Operational Inbox remain unchanged.
- Re-upgrade: replay the same source receipt and assert HTTP 200 duplicate with no second workflow/run/audit.
- Version skew: an unsupported contract version is rejected before writes and remains retryable from the source-owned outbox after the control plane is upgraded.

## Security Release Check

- Production ingest accepts only `internal` or `service-token` credentials with project access.
- Human bearer/cookie auth and cookie/session-only POST are rejected.
- CSRF exemption matches only exact `POST /api/run-receipts/ingest`; near-match and other methods remain protected.
- Evidence remains source-owned by URL or opaque artifact/log reference.
