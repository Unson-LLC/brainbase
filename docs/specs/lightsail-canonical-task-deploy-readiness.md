# Spec: Canonical Task post-deploy readiness gate

`scripts/verify-canonical-task-deploy-readiness.mjs` sends an authenticated
`POST /api/companion/tasks` with an intentionally invalid empty body. The
service checks mutation readiness before request validation, so:

- `422 validation_failed` proves the gate is open without creating a task.
- `503 canonical_task_mutation_not_ready` proves the gate is closed.
- Every other response is an unsafe or unexpected state and fails the check.

When `--evidence <path>` is provided for a closed runtime, the script delegates
to the existing `setCanonicalTaskReadiness --enable` path. That path validates
the evidence against the current source HEAD, writer token, store manifest,
schema version, and backend before updating readiness. The script then repeats
the live probe; only a `422 validation_failed` readback succeeds.

The deployment runbook invokes the script after restart under the service's
environment. Operators supply evidence only when guarded automatic source-head
rebind cannot keep the gate open.
