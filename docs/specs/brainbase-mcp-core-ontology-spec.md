---
spec_id: SPEC-brainbase-mcp-core-ontology
title: Brainbase MCP Core ontology / Extension registry 仕様
status: draft
date: 2026-06-08
story_id: story-brainbase-mcp-core-ontology
implementation_files:
  - mcp/brainbase/src/sources/graphapi-source.ts
  - mcp/brainbase/src/indexer/types.ts
  - mcp/brainbase/src/indexer/index.ts
  - mcp/brainbase/src/server.ts
test_files:
  - mcp/brainbase/tests/sources/graphapi-source.test.ts
  - mcp/brainbase/tests/tools/core-ontology.test.ts
  - mcp/brainbase/tests/tools/server-core-ontology.test.ts
  - tests/e2e/story-brainbase-mcp-core-ontology-contract.spec.ts
---

# SPEC: Brainbase MCP Core ontology / Extension registry

## 目的

Brainbase MCPに、OSS利用者にも扱いやすい固定Core ontologyを提供する。同時に、Graph SSOTの拡張性は維持し、組織固有typeは明示的なExtension registryとして扱う。

MCPは任意のGraph `entity_type` をすべて通常の第一級typeにしてはいけない。通常surfaceはCore ontologyに限定し、拡張typeは発見可能かつ明示指定時だけ検索できる形にする。

## 不変条件

- **INV-1**: MCPのdefault entity surfaceはCore ontologyだけである。
- **INV-2**: `brand` はCore entity typeであり、default search/indexに含まれる。
- **INV-3**: MCP公開type `raci` はGraph storage type `raci_assignment` にマップされる。
- **INV-4**: Graph storage type `raci_assignment` はMCP上では公開type `raci` として整形される。
- **INV-5**: `frame`、`story`、公開プロフィール系、infra固有レコードは、将来Storyで昇格されない限りExtension typeである。
- **INV-6**: Extension typeは隠さない。metadataとして発見可能にする。
- **INV-7**: Extension entityは、明示的なextension APIまたはadvanced filterでのみ検索できる。
- **INV-8**: `search` は既定で全Core entity mapを検索する。
- **INV-9**: `search` は既定ではExtension entityを含めない。
- **INV-10**: 既存の `project`、`person`、`org`、`app`、`customer`、`decision` の挙動は後方互換を保つ。
- **INV-11**: 未知のGraph entity typeがあってもMCP初期化は落ちない。
- **INV-12**: Core type registryはテストで固定し、将来の追加が意図的な変更になるようにする。
- **INV-13**: legacy `FilesystemSource` のcustomer table parserは、`customer_id` が欠落した行をindexしない既存挙動を維持する。

## シナリオ

### S-1: brandはdefault searchで見つかる

- given: Graphに `entity_type='brand'` の `brand_baao` が存在する。
- when: MCP searchを `BAAO Brand Guide` で実行する。
- then: extension opt-inなしでbrand結果が返る。

### S-2: raci互換

- given: Graphに `entity_type='raci_assignment'` が存在する。
- when: MCP callerが `list_entities type='raci'` を実行する。
- then: MCPはRACI recordを公開type `raci` として返す。

### S-3: extensionは発見可能だがdefault noiseにしない

- given: Graphに `entity_type='frame'` が存在する。
- when: MCP callerがdefault `search` を実行する。
- then: frame recordは既定では含まれない。
- when: callerがextension type `frame` を明示して検索する。
- then: frame recordが返る。

### S-4: 未知extension type

- given: Graphに未知のentity typeが存在する。
- when: GraphAPISourceがinitializeする。
- then: MCP startupは正常に続行し、登録済みまたは発見可能なextension metadataとしてのみ扱う。

### S-5: documentはCoreである

- given: Graphに運用docs由来の `entity_type='document'` recordが存在する。
- when: MCP default searchがdocument title/contentに一致する。
- then: document結果がCore contextとして返る。

### S-6: legacy filesystem customer rowの後方互換

- given: legacy `_codex` filesystem sourceの `common/meta/customers.md` に `customer_id` がある行と欠落した行が混在する。
- when: `FilesystemSource.getCustomers()` を実行する。
- then: `customer_id` がある行だけをcustomer entityとして返し、欠落行は従来通りskipする。

## 検証

| Clause | Test |
|---|---|
| INV-1, INV-2, INV-8, S-1 | `mcp/brainbase/tests/tools/core-ontology.test.ts` |
| INV-3, INV-4, S-2 | `mcp/brainbase/tests/sources/graphapi-source.test.ts` |
| INV-5〜7, INV-9, S-3 | `mcp/brainbase/tests/tools/core-ontology.test.ts` |
| INV-10, INV-11, S-4 | `mcp/brainbase/tests/sources/graphapi-source.test.ts` |
| S-5 | `mcp/brainbase/tests/tools/core-ontology.test.ts` |
| INV-13, S-6 | `mcp/brainbase/tests/sources/filesystem-source.test.ts` |
| MCP tool schema / handler surface | `mcp/brainbase/tests/tools/server-core-ontology.test.ts` |
| Story AC-1〜AC-11 | `tests/e2e/story-brainbase-mcp-core-ontology-contract.spec.ts` |

## 実装メモ

- Graph SSOTのwrite pathは柔軟なままにする。このStoryはGraph storageではなく、MCPのindexing/presentationを変更する。
- `server.ts`、`types.ts`、`graphapi-source.ts` に散らばった配列を増やすのではなく、中央のregistry objectへ寄せる。
- `list_entities` は通常利用者向けに単純さを保つ。Extension listing/queryは明確にadvanced pathとして命名する。
