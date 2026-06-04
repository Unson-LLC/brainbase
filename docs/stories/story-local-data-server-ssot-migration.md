---
story_id: story-local-data-server-ssot-migration
title: Local data to server Graph SSOT migration
source:
  type: conversation
  origin: user
  date: 2026-06-04
architecture_docs:
  - path: docs/architecture/local-data-server-ssot-migration-architecture.md
    status: draft
related_specs:
  - docs/specs/local-data-server-ssot-migration-spec.md
status: in_progress
---

# Local data to server Graph SSOT migration

## Background

佐藤さんのGraphSSOTは、サーバ側 `bb.unson.jp` / Lightsail PostgreSQL と、ローカル `_codex`、Wiki、31013 write path、Codex/Claude Code会話ログに分かれている。

目的はサーバ側データを消すことではない。ローカルに残っている正本候補を、サーバ側のGraph SSOT / Wiki DB / candidate-storeへ追加・統合し、ローカルを正本ではなくmirror/cache/source evidenceへ下げること。

2026-06-04時点の確認では、サーバ側には `document` 753件、`contact` 5038件、`person` 113件、`decision` 201件、`wiki_pages` 267件、`memory_candidates` 2374件が存在する。一方で `memory_candidates.promoted_graph_entity_id` は0件で、Personal KGのGraph昇格は未完了。

## Goal

ローカルに残っている正本候補を非破壊・追跡可能な形でサーバ側SSOTへ移す。

## Non-Goals

- サーバ側の既存Graph/Wiki/candidateデータ削除。
- raw transcript / raw conversation log のGraph直投入。
- 個人・顧客・機密情報の無レビューGraph昇格。
- UI改善やE2E UI検証。
- 大田原さん向けMCP profile変更。

## Migration Waves

### Wave 0: Inventory and Diff

- ローカル `_codex`、workspace-root content directories (`common`, `brand`, `knowledge`, `sns`, `decisions`; `projects` は重いため明示指定)、Wiki、Codex/Claude Codeログを棚卸しする。
- サーバ側と `source_path`、`content_hash`、canonical keyで照合する。
- 結果を `local_only`、`existing_server_match`、`existing_server_path_only`、`conflict`、`needs_extraction` に分類する。
- 本番DBへは書き込まない。

### Wave 1: Catalog and Document Ingest

- `_codex/common/meta/*` の安定ID系を `graph_entities` / `graph_edges` へ寄せる。
- `_codex/projects/**`、`_codex/sns/**`、Wiki本文は `document` / `wiki_pages` として寄せる。
- 既存サーバデータは消さず、path/hashが一致するものはskipする。

### Wave 2: Personal KG Candidate Ingest

- `~/.codex` / `~/.claude` の会話ログは rawのままGraphへ入れない。
- extraction後、owner-visible `memory_candidates` として保存する。
- `source_event_ids` によるdedupeを必須にする。

### Wave 3: Promotion Review

- candidateのうち、Graph catalog typeに写像できるものだけ承認フローで昇格する。
- `promoted_graph_entity_id` と audit event を残す。
- pending/rejected/expiredはGraph entityとして返さない。

## Acceptance Criteria

- [ ] `scripts/local-data-server-ssot-inventory.js --json` でローカル移行候補のdry-run inventoryを出せる。
- [ ] `--compare-server` 指定時に、サーバ側SSOTとの差分を非破壊で分類できる。
- [ ] inventory resultは各itemに `source_path`, `source_kind`, `target_table`, `target_type`, `content_hash`, `migration_status` を持つ。
- [ ] raw conversation logs are classified as `needs_extraction`, not Graph-ready.
- [ ] migration architecture and spec define non-destructive behavior, dedupe keys, and review boundaries.
- [ ] tests cover classification, hash-based duplicate detection, and raw conversation log boundary.

## Verification

- `npm run test:run -- tests/unit/local-data-server-ssot-inventory.test.js`
- `node scripts/local-data-server-ssot-inventory.js --json --limit 20`
- `node scripts/local-data-server-ssot-inventory.js --json --compare-server --limit 20` with `INFO_SSOT_DATABASE_URL`
- `vibepro pr prepare . --base origin/develop --story-id story-local-data-server-ssot-migration`
