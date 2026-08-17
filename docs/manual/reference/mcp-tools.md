# MCPツール

Brainbase MCPは、ローカルの個人SSOTをAIエージェントから参照するためのtoolsを提供します。

## get_context

自分、仕事、関係性、プロジェクトを統合した初期文脈を取得します。任意の`project`と`as_of`で、追加される`canonicalGraph`のプロジェクト範囲と有効時点を指定できます。互換用のトップレベル`relationships`と`decisions`は、この指定では絞り込まれません。

```ts
mcp__brainbase__get_context({
  project: "project-atlas",
  as_of: "2026-08-17T00:00:00.000Z"
})
```

Graph v2では従来の応答を維持したまま`canonicalGraph`を追加し、正規エンティティ、探索に使ったエッジIDの`relationPath`、探索時点を返します。エッジ本体は返しません。

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

GraphとPersonal KGを横断検索します。任意の`project`と`as_of`は、正規Graph由来の候補と関係経路のプロジェクト範囲・有効時点へ適用されます。互換用のlegacy投影は、結果上で`projection`または`unresolved`として区別されます。

```ts
mcp__brainbase__search({
  query: "Cursorvers",
  project: "project-atlas",
  as_of: "2026-08-17T00:00:00.000Z"
})
```

検索結果だけで「存在しない」と断定しないでください。表記ゆれがありそうな場合は、別名や関連語でも確認します。

Graph v2の結果は従来の`source`、`id`、`title`、`text`、`score`を維持しつつ、`canonicalEntityId`、`recordClass`、`projectionOf`、`projectionSources`、`relationPath`、`authority`を追加します。`recordClass`は`canonical`、`projection`、`unresolved`を区別します。同名候補が複数あるlegacy記録を正規IDへ推測接続しません。

## resolve_entity

任意の文章に含まれる表現を、Graph v2の正規エンティティIDへ接続します。本文そのものではなくhashとspanを残す、検証可能なEvidence Receiptを返します。

```ts
mcp__brainbase__resolve_entity({
  text: "Atlas導入について田中さんに相談する",
  asOf: "2026-08-17T00:00:00.000Z",
  projectScope: {
    projectIds: ["project-atlas"],
    policy: "strict"
  }
})
```

必須入力は`text`と`asOf`です。任意で`dataDir`、抽出済みの`mentionSpans`、`projectScope`、対象を絞る`entityTypes`を渡せます。`resolve_entity`は`asOf`、`get_context`と`search`は`as_of`なので、項目名の違いに注意してください。

結果は表現ごとに`resolved`、`ambiguous`、`unresolved`を区別します。候補が複数ある場合や情報源を検証できない場合に、勝手に1件へ確定しません。トップレベルの`status`は、検証済みGraph v2なら`verified`、Graph v1なら`migration_required`、Graphの欠落・破損なら`unverified`です。`unverified`時のReceiptは`blocked`となり、未取得を「該当なし」へ丸めません。`asOf`は時点が有効なエンティティとエッジだけを使うための必須値です。

`projectScope.policy`は省略時に`strict`となり、次から選びます。

- `strict`: 指定プロジェクトへIDエッジで到達できる候補だけを使う
- `prefer_project`: 指定プロジェクトの候補を優先する
- `allow_global_fallback`: プロジェクト内に候補がない場合だけ全体へ広げる

Receiptには正規ID、候補根拠、Graph/Ontology/Resolverのversion、入力hash、source状態、決定論的digestが含まれます。元の本文やローカルの絶対pathはportable Receiptへ保存しません。

## search_personal_kg

価値観、判断基準、経験、SNS文脈などを検索します。

```ts
mcp__brainbase__search_personal_kg({
  query: "AIに判断基準を渡す"
})
```

Personal KGは個人の判断軸や経験を扱います。承認なしに仕事の正本へ昇格する場所ではありません。
人物やプロジェクトはGraph側にあるため、見つからない場合は`search_personal_kg`ではなく`search`を使います。

## onboarding_status

オンボーディングの状態を確認します。

```ts
mcp__brainbase__onboarding_status({})
```

## Connected-world onboarding

接続済みソースから最初の価値まで進める場合は、次の5 toolを順に使います。

1. `brainbase_onboarding_start`: 実際に呼び出せるsource inventoryと最初の価値を登録する。
2. `brainbase_onboarding_get`: receipt、候補、review、first-value状態を確認する。
3. `brainbase_onboarding_ingest`: 本文ではなくpointer、SHA-256 hash、permission snapshot、構造化候補を登録する。
4. `brainbase_onboarding_review`: `approve`、`edit`、`reject`、`merge`を記録し、確認済み候補だけをcanonical SSOTへ昇格する。
5. `brainbase_onboarding_first_value`: 回答本文ではなくhashと使用canonical IDを記録し、`useful`または`not_useful`を記録する。

取得不能、権限待ち、error、未確認は空の結果やreadyとして扱いません。全Drive、全mailbox、home directory全体ではなく、`start`が返す`selectedSourceIds`の最小scopeだけを取得してください。

### そのまま使える最小例

`start`の返却値には同じ値の`runId`と`id`があります。以降は`runId`を使います。

```ts
const started = await mcp__brainbase__brainbase_onboarding_start({
  valueTarget: "いまの重要案件を知る",
  sources: [
    { id: "gmail-main", mode: "gmail", status: "waiting_for_authorization" },
    {
      id: "drive-alpha",
      mode: "drive",
      status: "ready",
      evidencePointer: "drive://folder/alpha",
      permissionScope: ["folder:alpha"]
    }
  ]
})
```

`waiting_for_authorization`は0件でもreadyでもありません。上の例では`selectedSourceIds`に入った`drive-alpha`だけを取得し、receiptは`source`の内側に置きます。

```ts
const ingested = await mcp__brainbase__brainbase_onboarding_ingest({
  runId: started.runId,
  source: {
    sourceId: "drive-alpha",
    evidencePointer: "drive://folder/alpha",
    contentHash: "sha256:<64文字の小文字hex>",
    permissionSnapshot: { scopes: ["folder:alpha"] },
    collectionStatus: "collected"
  },
  candidates: [{
    kind: "decision",
    payload: {
      decision: "Ontology 1.0.0を現在の回答に使う",
      topic: "ontology-runtime",
      effectiveAt: "2026-08-05T00:00:00.000Z"
    },
    observationClass: "observed",
    evidenceId: "drive-item-1"
  }]
})
```

reviewは配列`actions`で渡します。`inferred`候補は直接`approve`できません。人が内容を確認したうえで`edit`するか、`reject`してください。

```ts
const reviewed = await mcp__brainbase__brainbase_onboarding_review({
  runId: started.runId,
  actions: [{
    candidateId: ingested.candidates[0].id,
    decision: "approve",
    reason: "正本の記載を人が確認した"
  }]
})
```

seed済み項目、未設定項目、接続状態を見て、次に何を埋めるべきかを判断します。

## get_ontology

同梱されている現行Ontology 2.0.0を取得します。Personal OSのファイルを読めない状態でも利用できます。

```ts
mcp__brainbase__get_ontology({})
```

返す5領域は、型、関係語彙、制約、推論、変更管理です。

## audit_ontology

ローカル正本を、Graph v2に記録されたOntology bindingまたは指定した履歴versionに照らして監査します。

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
  ontologyVersion: "2.0.0"
})
```

同じ `topic` の有効Decisionが複数ある場合は、勝手に優先順位を付けず競合として返します。
`ontologyVersion: "0.0.0"`では、1.0.0で追加された`effectiveAt`、supersession、conflict推論を過去へ遡及適用せず、そのversionを結果に記録します。

## ontology_impact

過去versionから現行2.0.0への互換性、変更点、移行、ロールバック方法を取得します。

```ts
mcp__brainbase__ontology_impact({
  fromVersion: "0.0.0"
})
```
