---
adr_id: ADR-018
title: Retire Brainbase Wiki as an independent storage system
status: accepted
date: 2026-07-22
related_docs:
  - docs/architecture/ADR-017-agent-first-product-surface.md
  - docs/architecture/brainbase-web-surface-retirement-inventory.md
supersedes: []
superseded_by: []
---

# ADR-018: Retire Brainbase Wiki as an independent storage system

## Context

Brainbase Wiki duplicates content between a local Markdown tree and `wiki_pages`, adds bidirectional synchronization and access metadata, and is still consumed by legacy UI, MCP and scripts. Brainbase Web is being retired under ADR-017, so a separate human-facing Wiki product no longer justifies another canonical store.

The existing corpus is migration evidence. Unknown, dirty or unclassified pages must not be deleted merely because the product boundary changed.

## Decision

Brainbase Wiki is retired as a writable storage system. Brainbase remains the retrieval, authorization, automation and agent control plane over canonical sources; it does not own a second copy of general documentation.

| Information | SSOT |
|---|---|
| organizational facts and relationships | Graph |
| code, technical design, shared policy and runbooks | owning Git repository |
| business documents, collaborative files and binaries | owning team Drive |
| personal/private material | workspace home |

The initial retirement retained reads, manifest and bulk pull for inventory and export. That transitional runtime contract is superseded by the decision below.

### 2026-09-20: 未使用Wikiの実行経路を撤去

利用者がWikiを使用していないことを確認した。静的なコード参照は実利用の証拠ではないため、残った参照だけを理由に移行運用を維持しない。

- APIは読取り・manifest・pullも含めHTTP 410を返す。既存のエラーコードはクライアント互換のため保持する。
- CLIのsync/pull/push/statusは、認証・通信・ファイル操作前に廃止を通知する。
- Wiki service/controller、起動時注入、portalのWiki補完、MCP tool/resourceを除去する。
- 保存済みデータ・旧移行スクリプト・本番反映はこの変更に含めない。データ削除の条件とバックアップ要件は下記のまま維持する。

対象仕様: `docs/specs/unused-wiki-retirement.md`

## Migration phases

1. Freeze all Wiki write paths while retaining export and rollback evidence.
2. Inventory every page with hash, source or generation lineage, owner, audience, authority, freshness, references and proposed destination.
3. Move or re-express content in its owning SSOT; fix consumers and links without deleting unknown artifacts.
4. Prove zero writers and zero active consumers of `wiki_pages`, retain a checksummed export for the agreed retention period, then remove the Wiki API, CLI, MCP tools, UI modules and database tables.

Graph-generated Markdown mirrors are not migrated as documents: consumers should query Graph. Git and Drive documents may contain stable Graph identifiers or links, but must not copy Graph facts as another authority.

## Exit criteria

- every legacy page has an owner/destination/status entry or is explicitly marked `unknown_protected`;
- export count and checksums reconcile with the server manifest;
- no production writer calls Wiki page mutation endpoints;
- each remaining reader has moved to Graph, Git or Drive, or has an explicit approved exception;
- links and generated references pass regression checks;
- `wiki_pages` removal has a backup, retention decision and tested rollback procedure.

## Consequences

The information model becomes smaller: sources own information, while Brainbase finds and operates on it. Migration takes longer than deleting the Wiki tree, because ambiguous pages and consumers remain protected until their authority is proven.
