# Canonical Task record kinds — unreleased

Unreleased; publish needs separate approval. Package version remains 0.47.0.
This change contains kernel support for requirements ledger Spec 1, task r=77cf7238.

- The shared schema adds `record_kind TEXT NOT NULL DEFAULT 'work'`, its
  three-value CHECK and the partial ledger index from Spec §2.2. Existing rows
  become `work`. It also adds nullable `ledger_attributes JSONB` and
  `ledger_agreed BOOLEAN` with the exact §2.5 CHECK, including `NOT VALID`.
  Requirements accept NULL, false or true; work and requests accept NULL only.
  The host migration operator must run `VALIDATE CONSTRAINT
  canonical_tasks_ledger_agreed_check` in a separate migration window. Schema
  reapplication preserves the two new constraints and their validation state.
- Create accepts `record_kind: 'work' | 'request' | 'requirement'`; omission
  means `work`. Work INSERTs omit the column and use the database default,
  including explicitly supplied `work`. Invalid values, including NULL, fail
  validation. Historical work create fingerprints remain compatible with
  persisted idempotent replays.
- Create also accepts nullable `ledger_attributes` objects and `ledger_agreed`
  booleans for ledger records. Work rejects either field, including explicit
  NULL. Attributes must contain plain JSON, with at most 128 object/array levels
  and 64 KiB of serialized UTF-8 JSON. Non-NULL agreement requires a requirement.
  These fields and `record_kind` are absent from the general update allowlist. Host policy owns
  kind-specific attribute keys, agreement authority and ledger route validation.
- Normalized output includes `record_kind`. Missing, NULL or unsupported stored
  values become `unknown` with an `unknown_record_kind` warning. Agreement NULL
  remains NULL, and false remains false.
- General updates, transitions, source-reference appends and deletes refuse known ledger
  records with HTTP status 409 and code `ledger_record_use_ledger_api` before
  operation coordination. PostgreSQL additionally predicates UPDATE and DELETE on
  `record_kind = 'work'`, including legacy ID locators and guarded transactions,
  so a concurrent kind change cannot let a general mutation modify or delete a
  ledger row.
  Unknown stored kinds are also refused by PostgreSQL. Older host repositories
  that omit the field retain their mutation behavior and must implement their own
  atomic write guard when adding ledger support.

Apply the additive schema before deploying this kernel. The org migration
`canonical-task-record-kind.v1` must use the same canonical_tasks DDL. Keep
ledger writes closed until the host's work-only list/search/queue predicates
are deployed and verified (Spec §4.1).

`canonical_task_aliases` belongs to the org migration (§2.6, §4.1 step 2, AC-1):
it is an organization-scoped, stateless alias index pointing to canonical tasks,
not a second task store. Its proposed counters and the migration-run tables
also remain in the org layer. The OSS single-owner schema gains no organization
or migration-approval concepts. This change does not implement host ledger APIs,
read predicates, UI, queue behavior, organization migrations or authorized
kind-change operations. U-1 through U-4 and external role/run/gate/connection/
observation readers introduce no kernel configuration points here.

Tests extend the existing Vitest service, adapter and PostgreSQL integration
suites. `npm run test:canonical-task-postgres` accepts
`CANONICAL_TASK_PG_TEST_ADMIN_URL` to create/drop a disposable local database,
or the existing `CANONICAL_TASK_PG_TEST_URL` for an isolated schema in a
disposable local database. Missing configuration skips the suite (unchanged
behaviour); `CANONICAL_TASK_PG_TEST_REQUIRED=1` fails when neither URL is set.
The package CI (`.github/workflows/test.yml`, Node 22 complete suite)
provisions PostgreSQL and sets `CANONICAL_TASK_PG_TEST_ADMIN_URL`,
`CANONICAL_TASK_PG_TEST_URL` and `CANONICAL_TASK_PG_TEST_REQUIRED=1`, so the
suite runs there and fails instead of skipping if the URL goes missing. Other
`npm test` callers without PostgreSQL (for example release validation) still
skip it. The PostgreSQL suite was run on a disposable box-local PostgreSQL.

Rollback: before any ledger rows exist, the kernel can be reverted to 0.47.0
and the host migration operator may drop the two constraints and partial index.
Once request/requirement rows exist, do not drop `record_kind`, `ledger_attributes`
or `ledger_agreed` (data loss). Older kernels ignore these columns, and the DB
default keeps new rows as work.

No npm publication, version bump, production DDL or deployment is included.
