# run_receipt.v1 Contract

The normative requirements are defined in `docs/specs/cross-runtime-run-receipt-inbox-v1.md` and the ownership boundary in `docs/architecture/ADR-016-run-receipt-control-plane-boundary.md`.

Brainbase owns contract validation, idempotent projection, project authorization, and inbox ordering. Source connectors own source authentication, scheduling, retries/outbox, and raw evidence retention.

Example:

```json
{
  "contract_version": "run_receipt.v1",
  "source": {
    "type": "mana",
    "workflow_id": "daily-secretary",
    "runtime_target": "lambda"
  },
  "run": {
    "project_id": "brainbase",
    "external_run_id": "2026-07-15T09:00:00+09:00",
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
    "idempotency_key": "rr1_4a048aebdb1ef3d9da64227ec184c94f685dcaaef6b8c3f4285d5ecb38325110",
    "attempt": 1,
    "sent_at": "2026-07-15T09:02:03+09:00"
  }
}
```

The digest shown above is the SHA-256 value for the example tuple `["brainbase","mana","2026-07-15T09:00:00+09:00"]`; connectors must compute it from the normative canonical tuple algorithm in the Spec.
