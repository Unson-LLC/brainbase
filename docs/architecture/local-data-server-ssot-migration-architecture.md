---
architecture_id: arch-local-data-server-ssot-migration
story_id: story-local-data-server-ssot-migration
title: Local data to server Graph SSOT migration architecture
status: draft
date: 2026-06-04
related_specs:
  - docs/specs/local-data-server-ssot-migration-spec.md
---

# Architecture: Local Data to Server Graph SSOT Migration

## Center Pin

The migration is additive and evidence-preserving. Server-side SSOT data is never deleted as part of this story. Local data is treated as source evidence and moved into the correct server-side layer only after classification.

## Boundary

```text
local sources
  -> inventory / scan / diff
  -> migration ledger
  -> target-specific ingest
  -> review / promotion gate where needed
  -> server-side Graph SSOT / Wiki DB / candidate-store
```

## Source Layers

- `_codex/common/meta/**`: catalog candidates for Graph entities and edges.
- `_codex/projects/**`, workspace `projects/**`, `_codex/sns/**`, workspace `sns/**`: document candidates; only selected philosophy/decision material may later promote. Workspace `projects/**` is opt-in for inventory because it may include large project trees.
- `wiki/**/*.md`: Wiki page candidates.
- `~/.codex/**`, `~/.claude/projects/**/*.jsonl`: raw activity evidence; candidate extraction input only.
- local 31013 wiki write path: operation surface, not final authority.

## Target Layers

- `graph_entities` / `graph_edges`: stable catalog facts such as person, org, customer, partner, project, decision, philosophy, glossary, story, contact, app, brand, RACI.
- `wiki_pages`: readable pages whose content remains document-like.
- `memory_candidates`: owner-visible cognitive memory and extracted conversation/meeting learnings.
- promotion audit tables: evidence for candidate approval/rejection/promotion.

## Invariants

- Existing server rows are not deleted by migration code.
- A local item must be classified before any write path is enabled.
- `source_path` and `content_hash` are captured before comparing or writing.
- Path-only matches are not treated as exact matches when the target has a stored content hash that differs.
- Raw logs and transcripts are never Graph-ready; they require extraction into candidate-store first.
- Cognitive types stay in candidate-store until a promotion gate maps them to an existing catalog type.
- Secrets/PII findings block or mark review before write.

## Dedupe Keys

- Graph document: `payload.source = 'codex'` + `payload.path`.
- Local common meta catalog rows: source-specific stable id when available, otherwise normalized path.
- Wiki page: `wiki_pages.path` plus `content_hash`.
- Candidate memory: `(source_system, owner_person_id, source_event_ids::text)`.
- Migration ledger: `migration_batch_id` + `source_path` + `content_hash`.

## Migration Ledger

The first implementation records inventory as a JSON report. Later write-enabled migration must persist an equivalent ledger with:

- `migration_batch_id`
- `source_path`
- `source_kind`
- `content_hash`
- `target_table`
- `target_type`
- `target_id`
- `migration_status`
- `review_reason`
- `created_at`

## Failure Handling

- Missing server connection keeps inventory usable and marks server comparison as unavailable.
- Any secret scan block stops write planning for that item.
- Any `conflict` item remains review-only until a human chooses merge/update/skip.
- If a source cannot be parsed, it remains `needs_review` with source path and error metadata.
