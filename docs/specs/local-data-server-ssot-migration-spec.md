---
spec_id: SPEC-local-data-server-ssot-migration
title: Local data to server Graph SSOT migration specification
status: draft
date: 2026-06-04
story_id: story-local-data-server-ssot-migration
implementation_files:
  - scripts/local-data-server-ssot-inventory.js
test_files:
  - tests/unit/local-data-server-ssot-inventory.test.js
  - tests/e2e/story-local-data-server-ssot-migration-cli.spec.ts
---

# SPEC: Local Data to Server Graph SSOT Migration

## Purpose

Provide a non-destructive inventory and diff path for moving local Brainbase source-of-truth candidates into server-side Graph SSOT, Wiki DB, and candidate-store.

## Contract

```ts
type LocalInventoryItem = {
  source_path: string;
  source_kind: 'codex' | 'wiki' | 'conversation_log';
  source_subtype: string;
  target_table: 'graph_entities' | 'wiki_pages' | 'memory_candidates';
  target_type: string;
  content_hash: string | null;
  migration_status: 'local_only' | 'existing_server_match' | 'existing_server_path_only' | 'conflict' | 'needs_extraction' | 'needs_review';
  review_reason?: string;
};
```

## Invariants

- **INV-1**: Inventory mode performs no database writes.
- **INV-2**: Every file-based item has a SHA-256 `content_hash`.
- **INV-3**: Existing server data is never classified for deletion.
- **INV-4**: Raw Codex/Claude Code logs target `memory_candidates` with `needs_extraction`.
- **INV-5**: `_codex/common/meta/people` targets `graph_entities:person`.
- **INV-6**: `_codex/common/meta/customers` targets `graph_entities:customer`.
- **INV-7**: `_codex/sns/**`, `_codex/projects/**`, and workspace-root `sns/**` / `projects/**` default to `graph_entities:document` unless a later review maps them to a catalog type.
- **INV-8**: `wiki/**/*.md` targets `wiki_pages`.
- **INV-9**: Server comparison can mark exact hash matches, path-only matches, conflicts, or local-only items.
- **INV-10**: Conversation/cognitive memory promotion remains out of scope for inventory; promoted Graph writes require a separate gate.
- **INV-11**: When multiple local roots produce the same `target_table|target_type|source_path`, inventory keeps the first root in collection priority order as the comparable item and emits lower-priority duplicates as `needs_review`. The default priority is `_codex` before workspace content, so declared `_codex` SSOT files are not turned into conflicts by older workspace duplicates, and the suppressed duplicates remain visible to operators.
- **INV-12**: Hidden dotfiles under document roots are not indexed as Graph documents. Token/cache files such as `.x_oauth2_token.json` must not become `graph_entities:document` candidates.

## Scenarios

### S-1: local common meta person

- given: `_codex/common/meta/people/ota_shi.md`
- when: inventory runs
- then: item targets `graph_entities` with `target_type=person`.

### S-2: local SNS draft

- given: `_codex/sns/drafts/foo.md`
- when: inventory runs
- then: item targets `graph_entities:document` and remains document-level unless reviewed.

### S-3: raw conversation log

- given: `~/.codex/history.jsonl`
- when: inventory runs
- then: item targets `memory_candidates` and status is `needs_extraction`.

### S-4: server exact match

- given: server index has the same `source_path` and `content_hash`
- when: `compareWithServer` runs
- then: status is `existing_server_match`.

### S-5: server path-only match

- given: server index has the same path but no hash
- when: `compareWithServer` runs
- then: status is `existing_server_path_only`.

### S-6: duplicate local root

- given: `_codex/sns/rules.md` and workspace-root `sns/rules.md` both exist with different content
- when: inventory runs
- then: the `_codex` item is emitted as the comparable `graph_entities:document:sns/rules.md` item
- and: the workspace-root duplicate is emitted with `migration_status=needs_review`, `duplicate_resolution=suppressed_by_root_priority`, and the primary `source_root`.

## Verification

| Clause | Test |
|---|---|
| INV-2, INV-5〜8, S-1〜3 | `tests/unit/local-data-server-ssot-inventory.test.js` |
| INV-1, INV-3, INV-9, S-4〜5 | `tests/unit/local-data-server-ssot-inventory.test.js` |
| INV-11, S-6 | `tests/unit/local-data-server-ssot-inventory.test.js` |
| INV-12 | `tests/unit/local-data-server-ssot-inventory.test.js` |
