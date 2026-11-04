# PostgreSQL mutation recovery verification

The integration suite `tests/canonical-task-postgres-service.integration.test.ts`
checks the current OSS implementation against explicit mutation invariants using a
real disposable PostgreSQL database. It does not establish equivalence with a
historical customer implementation or replace the missing historical evidence.

| Scenario | Expected persisted result |
| --- | --- |
| Two updates target version 1 with distinct operation keys | One succeeds, one returns `version_conflict` (409); row is version 2 with the winner's title; one update audit entry |
| Update commits, then nontransactional audit sink fails | Caller receives `task_audit_unavailable` (503); row retains the update at version 2 |
| Reconstruct Service, PostgreSQL repository and coordinator; retry the failed-audit command twice | Same task ID, title and version 2; deterministic audit ID produces one logical audit entry |
| Reuse that command's key with different content and stale version | 409; no additional mutation |
| Transactional create audit fails (existing test) | No task row is committed |
| Readiness closes (existing test) | Mutations and replay fail closed |

Local verification on 2026-11-04 used PostgreSQL 17.11, Node 24.22.1 and the repository
SQL contracts: all 13 integration cases passed. CI additionally provisions
PostgreSQL 16 and requires this suite in the complete Node 22 job. The audit sink
in these tests is an in-memory idempotent map or an injected failure, not a real
external audit store. Reconstruction retains the current writer token and process
identity; this is not proof of a new process acquiring a writer lease after a
crash, nor of PostgreSQL server crash recovery or network partition handling.

Reproduce against a disposable local PostgreSQL server:

```sh
CANONICAL_TASK_PG_TEST_ADMIN_URL=postgresql://postgres@127.0.0.1:56232/postgres \
CANONICAL_TASK_PG_TEST_REQUIRED=1 npm run test:canonical-task-postgres
```

The runner must have permission to create a disposable database. Never point the
suite at a production database. Historical fixed revisions, original execution
artifact hashes and old/new scenario correspondence remain unverified until the
baseline evidence is available.
