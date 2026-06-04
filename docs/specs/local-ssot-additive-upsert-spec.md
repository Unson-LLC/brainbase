---
spec_id: SPEC-local-ssot-additive-upsert
title: Local SSOT additive upsert specification
status: draft
date: 2026-06-04
story_id: story-local-ssot-additive-upsert
implementation_files:
  - scripts/local-data-server-ssot-upsert.js
  - scripts/local-data-server-ssot-inventory.js
test_files:
  - tests/unit/local-data-server-ssot-upsert.test.js
---

# SPEC: Local SSOT additive upsert

## Purpose

Provide a guarded insert-only path for moving local-only Brainbase catalog, document, and wiki source candidates into server-side SSOT.

## Contract

```ts
type UpsertPlan = {
  mode: 'dry_run' | 'execute';
  operations: UpsertOperation[];
  skips: UpsertSkip[];
  summary: {
    total: number;
    operations: number;
    skipped: number;
    by_operation_target: Record<string, number>;
    by_skip_reason: Record<string, number>;
  };
};

type UpsertOperation = {
  action: 'insert';
  target_table: 'graph_entities' | 'wiki_pages';
  target_type: string;
  target_id: string;
  source_path: string;
  title: string;
  content_hash: string;
};
```

## Invariants

- **INV-1**: Dry-run mode performs no database writes.
- **INV-2**: Only `migration_status=local_only` items are eligible for insert.
- **INV-3**: Only `graph_entities` and `wiki_pages` are eligible target tables.
- **INV-4**: `needs_extraction` items are always skipped.
- **INV-5**: `conflict`, `existing_server_match`, and `existing_server_path_only` are skipped with explicit reasons.
- **INV-6**: `_codex/common/meta/customers/**` maps to `graph_entities:customer` and remains eligible when server comparison marks it `local_only`.
- **INV-7**: Execute mode requires `--execute --confirm-additive-upsert`.
- **INV-8**: Execute mode requires a DB connection string.
- **INV-9**: Execute mode fails when planned writes exceed `--max-writes`.
- **INV-10**: Execute SQL contains no DELETE and no UPDATE.
- **INV-11**: Graph entity insert checks existing `payload.path` and `entity_type` before inserting.
- **INV-12**: Wiki page insert uses `ON CONFLICT (path) DO NOTHING`.

## Scenarios

### S-1: dry-run local-only document

- given: an item classified as `local_only` and `graph_entities:document`
- when: upsert plan is built
- then: the item becomes an insert operation.

### S-2: local common meta customer

- given: `_codex/common/meta/customers/hotel_m.md` is classified as `graph_entities:customer`
- when: upsert plan is built after server comparison marks it `local_only`
- then: the customer remains an insert operation.

### S-3: raw conversation log

- given: an item classified as `needs_extraction`
- when: upsert plan is built
- then: the item is skipped and not Graph-ready.

### S-4: server conflict

- given: an item classified as `conflict`
- when: upsert plan is built
- then: the item is skipped for human review.

### S-5: execute without confirmation

- given: execute mode without `--confirm-additive-upsert`
- when: guard validation runs
- then: the command fails before DB writes.

### S-6: insert-only apply

- given: an insert plan and a fake DB client
- when: apply runs
- then: executed SQL has INSERT only and contains no DELETE or UPDATE.

## Verification

| Clause | Test |
|---|---|
| INV-1, S-1〜3 | `tests/unit/local-data-server-ssot-upsert.test.js` |
| INV-6〜8, S-4 | `tests/unit/local-data-server-ssot-upsert.test.js` |
| INV-9〜11, S-5 | `tests/unit/local-data-server-ssot-upsert.test.js` |
