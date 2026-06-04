---
story_id: story-local-ssot-additive-upsert
title: Local SSOT additive upsert dry-run and guarded execute
source:
  type: conversation
  origin: user
  date: 2026-06-04
architecture_docs:
  - path: docs/architecture/local-ssot-additive-upsert-architecture.md
    status: draft
related_specs:
  - docs/specs/local-ssot-additive-upsert-spec.md
status: in_progress
---

# Local SSOT additive upsert dry-run and guarded execute

## Background

Wave 0で、佐藤さんのローカル `_codex`、workspace content、Wiki、会話ログをサーバ側SSOTと照合するdry-run inventoryを作った。

次は、ローカルだけに存在するcatalog/document/wiki候補をサーバ側へ追加できる道具が必要になる。ただし目的はGraphSSOTを綺麗にすることであり、サーバ側の既存データ削除や上書きではない。

## Goal

`local_only` の `graph_entities` と `wiki_pages` だけを、削除なし・上書きなし・dry-run既定でサーバ側SSOTへ追加できるCLIを用意する。

## Non-Goals

- サーバ側データの削除。
- 既存Graph/Wiki行のUPDATE。
- `conflict` / `existing_server_path_only` の自動解決。
- raw Codex/Claude Code conversation logのGraph直投入。
- memory candidate extraction / promotion。
- UI変更やUI E2E。
- 大田原さん向けMCP配布設定。

## Acceptance Criteria

- [ ] `scripts/local-data-server-ssot-upsert.js` は既定でdry-runし、DBへ書き込まない。
- [ ] upsert planは `migration_status=local_only` かつ `target_table=graph_entities|wiki_pages` のみをinsert対象にする。
- [ ] `_codex/common/meta/customers/**` は `graph_entities:customer` のlocal-only catalog候補としてinsert対象にできる。
- [ ] `needs_extraction`, `conflict`, `existing_server_match`, `existing_server_path_only` はskip reason付きで対象外にする。
- [ ] execute modeは `--execute --confirm-additive-upsert` とDB接続情報を要求する。
- [ ] execute modeは `--max-writes` を超える場合に停止する。
- [ ] DB操作はINSERT onlyで、DELETE/UPDATE/UPSERT update句を使わない。
- [ ] tests cover plan filtering, execute guard, dry-run no-write, and insert-only behavior.

## Human Stop Point

本番DBへの `--execute --confirm-additive-upsert` は人手確認が必要な停止点とする。ここまでにdry-run plan、テスト、VibePro Gate、PRを用意する。

## Verification

- `npm run test:run -- tests/unit/local-data-server-ssot-upsert.test.js`
- `node scripts/local-data-server-ssot-upsert.js --json --limit 20`
- `node scripts/local-data-server-ssot-upsert.js --json --compare-server --limit 20` with `INFO_SSOT_DATABASE_URL`
- `vibepro pr prepare . --base origin/develop --story-id story-local-ssot-additive-upsert`
