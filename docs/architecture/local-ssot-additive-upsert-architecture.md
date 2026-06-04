# Local SSOT additive upsert architecture

## Context

Wave 0 inventory classifies local items against server-side SSOT. Wave 1 adds a guarded write path for the subset that can be safely copied to server tables without deleting or overwriting existing server data.

## Flow

1. Collect local inventory with `scripts/local-data-server-ssot-inventory.js`.
2. Load the server index from `INFO_SSOT_DATABASE_URL` / `INFO_SSOT_DB_URL` / `DATABASE_URL`.
3. Compare local items with server rows.
4. Build an additive insert plan:
   - include only `local_only` rows;
   - include only `graph_entities` and `wiki_pages`;
   - skip raw conversation logs and review-required statuses.
5. Dry-run prints the plan and skip reasons.
6. Execute mode requires explicit confirmation and a write-count guard.

## Data Boundaries

`graph_entities` receives local catalog/document files as additive entities with deterministic migration IDs and payload evidence:

- `path`
- `source_kind`
- `source_subtype`
- `target_key`
- `content_hash`
- `content`
- `local_source_root`
- `migration_source=local_ssot_additive_upsert`

`wiki_pages` receives local wiki pages with path, title, content hash, size, and content.

Raw conversation logs remain outside this flow. They stay classified as `memory_candidates:personal_kg_candidate` with `needs_extraction`.

## Write Semantics

The write path is insert-only:

- `graph_entities`: `INSERT ... SELECT ... WHERE NOT EXISTS (...payload->>'path'...) ON CONFLICT (id) DO NOTHING`
- `wiki_pages`: `INSERT ... ON CONFLICT (path) DO NOTHING`

There are no DELETE statements and no UPDATE statements in this Wave. Conflicts and path-only server matches are a human review input, not an automated merge decision.

## Human Stop Point

Production execution is intentionally not automatic. The prepared script can produce the plan and pass gates, but running against production with `--execute --confirm-additive-upsert` requires human approval.
