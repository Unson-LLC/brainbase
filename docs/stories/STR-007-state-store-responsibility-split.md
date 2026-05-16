---
story_id: STR-007
vibepro_story_id: story-architecture-state-store-responsibility-split-20260510
title: State store責務分離を段階実装する
source_requirement:
  requirement_title: "VP-ACTION-ARCH-001 responsibility split campaign"
source_story:
  story_id: STR-006
  vibepro_story_id: brainbase-mana-secretary-memory-promotion-20260508
status: draft
created_at: 2026-05-10
updated_at: 2026-05-10
---

# STR-007: State store責務分離を段階実装する

## 背景

VibePro の `VP-ACTION-ARCH-001` は、`lib/state-store.js` と `lib/sqlite-store.js` に runtime state、migration、persistence、lock/recovery、watcher、SQLite access の責務が混在していることを検出した。

ただし STR-006 のセンターピンは、Brainbase と mana の Activity を Raw Ledger / Memory Candidate / Promotion Gate / Scoped Retrieval につなぎ、mana を Brainbase 横断秘書として動かすことである。state store の大規模責務分離を STR-006 に混ぜると、Memory Promotion Pipeline の完了境界がぼける。

そのため `VP-TASK-ARCH-001` は STR-006 では実装せず、この STR-007 に独立Storyとして切り出す。

## 現状

- `lib/state-store.js` は JSON state の読み書き、migration、recovery、watcher、session/task 取得を同じ class に持つ。
- `lib/sqlite-store.js` は SQLite schema migration、session/task persistence、lock 状態、query helper を同じ class に持つ。
- Graphify evidence では対象が 4 community に跨り、hub は `StateStore.get()`、`StateStore`、`SqliteStore`、`StateStore.update()`、`StateStore.init()` に集中している。
- `VP-CAMPAIGN-REF-001` の opportunity は `VP-OPP-ARCH-001` と `VP-OPP-ARCH-002` の2件。

## 変更内容

### Phase 1: Contract固定

- `StateStore.get()`、`StateStore.update()`、`init()`、session/task 取得の返却shapeをテストで固定する。
- JSON store と SQLite store の互換境界を文書化する。
- recovery、watcher、migration の副作用タイミングを先にテストで押さえる。

### Phase 2: 副作用境界の切り出し

- JSON file I/O、watcher、recovery を `StateStore` から小さな helper/service へ分ける。
- SQLite migration と query helper を `SqliteStore` の外側へ段階的に逃がす。
- 呼び出し元の import path と public method shape は維持する。

### Phase 3: Persistence adapter整理

- JSON store と SQLite store の共通化は、実際に同じ契約で扱える範囲に限定する。
- Graphify 上で別 community と判定されている責務は、無理に1つの抽象へ畳まない。
- state runtime、persistence、migration、watch/recovery がレビュー可能な単位に分かれたら完了とする。

## 実装順

1. `lib/state-store.js` の `get/update/init` contract test を追加する。
2. `lib/state-store.js` の watcher/recovery を副作用 helper に分離する。
3. `lib/sqlite-store.js` の schema migration と query helper を分離する。
4. JSON/SQLite の共通 adapter 化は、重複より責務境界が明確になる場合だけ行う。

## 判断根拠

- `impact_score`: 0.0319
- `community_span`: 4
- `related_edge_count`: 280
- `hub_nodes`: `StateStore.get()` degree 159、`StateStore` degree 27、`SqliteStore` degree 23、`StateStore.update()` degree 16、`StateStore.init()` degree 13
- `recommended_strategy`: `split-by-graph-community`

Graphify 上で複数 community に跨るため、先に flow ごとの責務差分を固定し、共通化は安定した境界に限定する。

## 受け入れ基準

- [ ] `lib/state-store.js` と `lib/sqlite-store.js` の public API の返却shapeが既存互換である。
- [ ] migration、watcher、recovery、persistence の副作用タイミングがテストで固定されている。
- [ ] `StateStore.get()` に集中している責務が、読み取り契約と副作用境界へ分離されている。
- [ ] SQLite schema migration と query helper がレビュー可能な単位へ分かれている。
- [ ] 関連 unit/integration test が通る。
- [ ] VibePro diagnose で `VP-ARCH-001` の責務混在候補または対象行数/根拠が減っている。

## スコープ外

- STR-006 の Memory Promotion Pipeline の挙動変更
- Raw Ledger / Memory Candidate / Promotion Gate の仕様変更
- Graph DB や新規 persistence engine の導入
