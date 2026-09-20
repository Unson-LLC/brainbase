---
spec_id: SPEC-canonical-task-postgres-contract-fixtures
title: Canonical Task PostgreSQL契約fixture Spec
status: done
date: 2026-09-20
story_id: story-canonical-task-postgres-contract-fixtures
implementation_files:
  - tests/e2e/story-canonical-task-postgres-ssot-contract.spec.ts
test_files:
  - tests/e2e/story-canonical-task-postgres-ssot-contract.spec.ts
---

# Canonical Task PostgreSQL契約fixture Spec

## Invariants

- fixtureのschema応答は、`scripts/migrate-canonical-task-postgres-store.js`の現行schema preflight契約と一致する。
- 必須列には`project_codes`を含める。
- 必須indexは`canonical_tasks_status_priority_idx`、`canonical_tasks_assignee_due_idx`、`canonical_tasks_project_codes_idx`、`canonical_tasks_title_trgm_idx`、`canonical_tasks_search_cursor_idx`の5本とする。
- 各indexは`indisvalid=true`かつ`indisready=true`を返す。
- production code、schema assertion、failure assertionをfixture都合で弱めない。

## Scenario Contract

- S-003 dry-runはschema preflight後にredacted/write-freeの契約を検証する。
- provider failureはschema preflight後にsource providerのエラーを検証する。
- S-006 conflictはschema preflight後にcross-key conflictを検証する。
- persistence failureはschema preflight後にinsert failureとrollbackを検証する。

## Verification

```bash
VIBEPRO_EVIDENCE_ID=dummy volta run --node 22.23.2 npx playwright test \
  tests/e2e/story-canonical-task-postgres-ssot-contract.spec.ts --reporter=line
```

このコマンドは対象fixtureのローカル契約テストのみを実行する。live PostgreSQL、CI、production migrationの成功はこのSpecの証拠に含めない。
