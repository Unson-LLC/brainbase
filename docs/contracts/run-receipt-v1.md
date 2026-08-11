# run_receipt.v1 Contract

The normative requirements are defined in `docs/specs/cross-runtime-run-receipt-inbox-v1.md` and the ownership boundary in `docs/architecture/ADR-016-run-receipt-control-plane-boundary.md`.

Brainbase owns contract validation, idempotent projection, project authorization, and inbox ordering. Source connectors own source authentication, scheduling, retries/outbox, and raw evidence retention.

Example:

```json
{
  "contract_version": "run_receipt.v1",
  "source": {
    "type": "mana",
    "workflow_id": "mana:lambda:daily-secretary",
    "runtime_target": "lambda"
  },
  "run": {
    "project_id": "brainbase",
    "external_run_id": "mana:lambda:daily-secretary:run:exec-20260715T090000+0900:attempt:1",
    "status": "success",
    "evidence_state": "confirmed",
    "started_at": "2026-07-15T09:00:00+09:00",
    "finished_at": "2026-07-15T09:02:00+09:00",
    "metrics": { "processed": 12 },
    "evidence_refs": [
      { "kind": "log_ref", "ref": "cloudwatch:log-stream/example" }
    ]
  },
  "delivery": {
    "idempotency_key": "rr1_6ab34574ce8e351fa5b615709151530481586c16cb126fc024ab1537316d38cc",
    "attempt": 1,
    "sent_at": "2026-07-15T09:02:03+09:00"
  }
}
```

The digest shown above is the SHA-256 value for the example tuple `["brainbase","mana","mana:lambda:daily-secretary:run:exec-20260715T090000+0900:attempt:1"]`; connectors must compute it from the normative canonical tuple algorithm in the Spec.

Duplicate comparison uses the normalized immutable `contract_version + source + run` projection defined by the Spec. The entire `delivery` object is excluded, so a retry may change `attempt` or `sent_at` without creating a conflict. Brainbase acquires the deterministic receipt identity lock first, then the repository-wide shared-ledger transaction. JsonFile publishes a fully written and fsynced pending lock with an atomic no-replace hard link, so partial JSON is never exposed at the canonical path. Expiry recovery serializes lock-file mutation, reclaims malformed legacy locks plus expired dead-owner or stale ownerless mutation artifacts, and atomically quarantines only the observed stale lock; a live local owner is preserved, and a fresh lock won by another repository is reported as contention. The shared boundary serializes distinct receipt identities and every production specialized automation service, WorkflowRunner, and external-runner writer before reload or commit. Same-async-owner nested transactions join the outer transaction without reacquiring locks; only the outermost unit commits or rolls back, and an inner failure makes it rollback-only. JsonFile shared-ledger collection mutation outside an active transaction is rejected before state changes. Identity-lock and transaction-lease metadata are separately synchronized control-plane state, never reload or mutate the shared ledger, and remain outside that guard. Seed workflows use the same lease and owner in a pre-publication initialization transaction. Long-running source/network/candidate-store execution never occurs while the file lease is held. Existing `external_runner.v0` candidates converge through deterministic pending intents and a collision-safe global Candidate Store id derived from contract, workspace, org, project, runner, external run, and source candidate identities. A duplicate create is adopted only after `findById` proves the immutable ingest projection equal; mismatch remains an explicit actionable conflict. Pending replay writes no duplicate audit, while a later fully converged replay keeps the legacy duplicate audit behavior.

Connectors must redact customer prose, credentials, raw logs, and transcripts before delivery. Operational summary/blocker text is bounded and single-line, action is an enum, metrics accept finite number/boolean/null only, and evidence handles must satisfy the exact HTTPS or opaque-reference schema in the Spec.
