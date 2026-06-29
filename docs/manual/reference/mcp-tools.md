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
