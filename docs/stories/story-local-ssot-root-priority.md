---
story_id: story-local-ssot-root-priority
title: Local SSOT duplicate root priority
source:
  type: production_migration_followup
  origin: local/server inventory conflict after additive upsert
  date: 2026-06-04
related_specs:
  - docs/specs/local-data-server-ssot-migration-spec.md
architecture_docs:
  - path: docs/architecture/local-ssot-root-priority-architecture.md
    status: draft
status: in_progress
---

# Local SSOT Duplicate Root Priority

## Background

After local SSOT additive upsert, server-side Graph rows matched the declared `_codex` SNS source of truth, but inventory still reported conflicts because older workspace-root `sns/**` files shared the same `source_path`.

The migration inventory must not turn an older local duplicate into a server conflict when a higher-priority local root already owns the same `target_table|target_type|source_path`.

## Goal

Keep one comparable local item per target key using collection priority. Default priority keeps `_codex` before workspace content, then wiki and conversation log sources. Lower-priority duplicates must remain visible as `needs_review` so operators can clean local split-brain state instead of losing evidence silently.

## Non-Goals

- Delete or rewrite local duplicate files.
- Overwrite server data from a lower-priority root.
- Promote raw conversation logs to Graph.

## Acceptance Criteria

- [ ] Inventory dedupes duplicate local roots by `target_table|target_type|source_path`.
- [ ] `_codex` wins over workspace content for the same target key.
- [ ] Suppressed lower-priority duplicates are visible as `needs_review` with duplicate metadata.
- [ ] A unit test covers the duplicate root case.
- [ ] Production compare inventory reports no `conflict` caused by the known SNS duplicate roots.

## Verification

- `npm run test:run -- tests/unit/local-data-server-ssot-inventory.test.js tests/unit/local-data-server-ssot-upsert.test.js`
- `BRAINBASE_E2E_REUSE_SERVER=true npx playwright test tests/e2e/story-local-ssot-root-priority-cli.spec.ts --reporter=line`
- `node scripts/local-data-server-ssot-upsert.js --json` with `INFO_SSOT_DATABASE_URL`
