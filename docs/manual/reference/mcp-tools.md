# MCPツール

Brainbase MCPは、ローカルの個人SSOTをAIエージェントから参照するためのtoolsを提供します。

## get_context

自分、仕事、関係性、プロジェクトを統合した初期文脈を取得します。

```ts
mcp__brainbase__get_context({})
```

## list_entities

指定した型のエンティティを一覧します。

```ts
mcp__brainbase__list_entities({
  type: "project"
})
```

主な型:

- `person`
- `org`
- `project`
- `relationship`
- `decision`

## search

GraphとPersonal KGを横断検索します。

```ts
mcp__brainbase__search({
  query: "Cursorvers"
})
```

検索結果だけで「存在しない」と断定しないでください。表記ゆれがありそうな場合は、別名や関連語でも確認します。

## search_personal_kg

価値観、判断基準、経験、SNS文脈などを検索します。

```ts
mcp__brainbase__search_personal_kg({
  query: "AIに判断基準を渡す"
})
```

Personal KGは個人の判断軸や経験を扱います。承認なしに仕事の正本へ昇格する場所ではありません。

## onboarding_status

オンボーディングの状態を確認します。

```ts
mcp__brainbase__onboarding_status({})
```

seed済み項目、未設定項目、接続状態を見て、次に何を埋めるべきかを判断します。

## get_ontology

同梱されているOntology 1.0.0を取得します。Personal OSのファイルを読めない状態でも利用できます。

```ts
mcp__brainbase__get_ontology({})
```

返す5領域は、型、関係語彙、制約、推論、変更管理です。

## audit_ontology

ローカル正本をOntology 1.0.0に照らして監査します。

```ts
mcp__brainbase__audit_ontology({})
```

正本を全件読めた場合だけ `status: "complete"` になります。欠損や壊れたファイルがある場合は `status: "unverified"`、`violationCount: null` を返し、0件とは扱いません。

過去snapshotを当時の意味で読む場合は、記録されたversionを指定します。

```ts
mcp__brainbase__audit_ontology({
  ontologyVersion: "0.0.0"
})
```

## infer_decisions

Decisionの明示的な `supersedes` から、有効、置換済み、競合を導出します。

```ts
mcp__brainbase__infer_decisions({
  asOf: "2026-08-03T00:00:00.000Z",
  ontologyVersion: "1.0.0"
})
```

同じ `topic` の有効Decisionが複数ある場合は、勝手に優先順位を付けず競合として返します。
`ontologyVersion: "0.0.0"`では、1.0.0で追加されたsupersession・conflict推論を過去へ遡及適用せず、そのversionを結果に記録します。

## ontology_impact

過去versionから1.0.0への互換性、変更点、移行、ロールバック方法を取得します。

```ts
mcp__brainbase__ontology_impact({
  fromVersion: "0.0.0"
})
```
