---
story_id: story-brainbase-mcp-core-ontology
title: Brainbase MCPを固定Core ontologyと明示的Extension registryに分ける
source:
  type: conversation
  origin: user
  date: 2026-06-08
architecture_docs:
  - path: N/A
    status: not_required
    reason: MCPのGraph source/indexer契約変更のみ。新しいruntime境界やinfra変更はない。
related_specs:
  - docs/specs/brainbase-mcp-core-ontology-spec.md
status: proposed
---

# Brainbase MCPを固定Core ontologyと明示的Extension registryに分ける

## 背景

Graph SSOTは任意の `entity_type` を保存できる。直近の `_codex` 復旧でも、`brand`、`frame`、`glossary_term`、`partner`、佐藤圭吾の公開プロフィール系レコードなどが追加された。

一方で、現在のBrainbase MCPがindexするtypeは `project`、`person`、`org`、`raci`、`app`、`customer`、`decision` の7つだけである。

この状態には2つの問題がある。

1. Graph SSOTには存在するのに、MCPから見えない安定概念がある。特に `brand` は、Brainbaseが組織・プロダクト・個人の名前、立ち位置、語り方、約束を判断するための中核情報である。
2. 逆に、Graph上の任意 `entity_type` をすべてMCPの第一級typeにすると、OSSとしての使い勝手が悪くなる。利用者にはまず固定ontologyが必要で、組織固有の拡張typeは明示的に触れる形がよい。

## 目的

Brainbase MCPは、OSS利用者にも理解しやすい固定Core ontologyを持つ。その上で、Graph SSOTの拡張性は維持し、組織固有typeはExtension registryとして明示的に発見・検索できるようにする。

`brand` は `org` の補助属性や汎用extensionではなく、Core ontologyの第一級typeとして扱う。

## Core Ontology

MCPの `list_entities` / `get_entity` が通常扱う第一級typeは次の通り。

- `project`
- `person`
- `org`
- `brand`
- `app`
- `customer`
- `partner`
- `decision`
- `raci`
- `glossary_term`
- `document`

`raci` はMCP公開typeとして維持する。ただしGraph storage上の実体は `entity_type='raci_assignment'` にマップする。

## Extension Ontology

次のtypeは有用だが、OSS利用者全員に常時見せるCore surfaceには入れない。

- `frame`
- `story`
- `infrastructure_environment`
- `speaking`
- `media_appearance`
- `role_assignment`
- `product`
- `publication`
- `press_mention`

これらは `list_extension_types`、`list_extension_entities`、またはadvanced search filterのような明示的な拡張経路で扱う。

## 受け入れ基準

- [ ] `mcp/brainbase/src/sources/graphapi-source.ts` が上記Core typeを取得する。
- [ ] MCP公開type `raci` がGraph storage type `raci_assignment` にマップされる。
- [ ] `mcp/brainbase/src/indexer/types.ts` に `Brand`、`Partner`、`GlossaryTerm`、`Document` がCore entityとして定義される。
- [ ] `mcp/brainbase/src/indexer/index.ts` が新しいCore entityをindexし、検索対象に含める。
- [ ] `mcp/brainbase/src/server.ts` の `list_entities` / `get_entity` が `brand` を含むCore ontologyに対応する。
- [ ] `search` はCore typeを既定で検索し、ブランドガイド名・alias・本文に一致した `brand` レコードを返す。
- [ ] Extension typeを `list_entities` の通常enumへ個別に全部追加しない。
- [ ] 登録済みExtension type metadataをCore ontologyとは別経路で取得できる。
- [ ] 既存callerが `type='raci'` を使っていても、Graphの `raci_assignment` を読んで動作し続ける。
- [ ] legacy `FilesystemSource` の既存customer table parsingは維持し、`customer_id` が欠落した行はこれまで通りindexしない。
- [ ] core type enum、`raci` mapping、brand search、extension opt-in、default entity listにextension noiseが混ざらないことをテストする。

## 検証

- `npm test -- --runTestsByPath mcp/brainbase/tests/sources/graphapi-source.test.ts`
- `npm test -- --runTestsByPath mcp/brainbase/tests/tools/core-ontology.test.ts`
- `npm test -- --runTestsByPath mcp/brainbase/tests/sources/filesystem-source.test.ts`
- `npm run typecheck`
- MCP daemon再起動後のsmoke:
  - `mcp__brainbase__list_entities type=brand`
  - `mcp__brainbase__search query="BAAO Brand Guide"`
  - `mcp__brainbase__list_entities type=raci`
  - extension queryで `frame_ai_driven_management_framework` が明示指定時だけ取れる

## レビュー観点

- Core type listは小さく、プロダクトとして説明できる範囲に保つ。多くのBrainbase OSS利用者が通常概念として必要とする場合だけCoreへ入れる。
- `brand` はCoreである。AI出力の品質、命名、positioning、tone、公開上の約束を左右し、`org`、`app`、`project`、`person` を横断するため。
- Extensionは二級データではない。組織固有schemaとして明示的に発見・検索できるが、default surfaceのノイズにはしない。
