---
spec_id: ux-20261001-06-source-navigation
story_id: story-ux-20261001-06-source-navigation
status: proposed
---

# UX-20261001-06 出典遷移 Spec

## 1. value-proofの出典descriptor

`decision.basis[]`は既存の`entity_id`と`application`を壊さず、必要な場合だけ次の`source`を持てる。

```ts
{
  kind: "local_graph",
  entity_id: string,
  entity_type: "person" | "org" | "project" | "decision",
  version?: string | null,
  digest?: string | null
}
```

`source.entity_id`は同じbasis entryの`entity_id`と一致しなければならない。`source`はURLではなく、画面が任意の外部先へ遷移しないためのtyped read contractである。実データに出典がない場合は`source`を生成しない。

## 2. host-owned reader

Personal Web hostはdescriptorを受け、Graphの既存read routeから`/entities/<encoded entity_id>`を読み戻す。UIはreaderの結果だけを使う。

| reader結果 | 画面 | リンク |
| --- | --- | --- |
| `available` | 対象IDと「出典を開く」 | 出す |
| `not_found` | 出典が見つかりません（未確認） | 出さない |
| `ambiguous` | 同じIDの出典が複数あります（未確認） | 出さない |
| `forbidden` | 出典を読む権限がありません（未確認） | 出さない |
| `unavailable` | 出典を確認できません（未確認） | 出さない |

`available`には、Graph readbackの`entity.id`・`entity.type`がdescriptorと一致することが必要。descriptorに`digest`または`version`があれば、readbackの同じ値も一致しなければならない。現在のGraph responseはdigestを返すが、version/revisionがない場合のversion指定は未確認とする。

## 3. 遷移先

リンクは同一オリジンの`#graph?entity_id=<URLSearchParams encoded>`だけを生成する。Graph画面はhash queryを読み、既存のGraph read/search経路から対象を選択して詳細を表示する。任意の`href`、外部URL、descriptorからのpath連結は許可しない。

## 4. 不変条件

1. source descriptorがない記録にはリンクを作らない。
2. source readが成功しない対象を、存在・出典あり・確認済みとして表示しない。
3. `entity_id`が同じでも種類、digest、versionが異なる対象はリンクを作らない。
4. journalの読取、保存、feedback、出典補完はこの仕様の対象外であり、元journalは不変とする。
5. source-bearing fixtureは架空データだけを使う。

## 5. 回帰テスト

- `tests/judgment-value-proof.test.ts`: descriptorの受理、basis対象とのID不一致、URL種別の拒否。
- `tests/ui/value-proof-review.test.mjs`: source-bearing readback成功のリンク、source-free、404/重複/認可不可/通信失敗の未確認表示。
- `tests/ui/local-web-shell.test.mjs`: `#graph?entity_id=`の解析、Graph対象詳細表示、reader結果に応じたリンク非表示。
- `tests/ui/ux06-source-fixture.mjs`: source-bearing Graph記録とvalue-proofを分離fixtureとして提供する。実journalや個人データは参照しない。
- `tests/ui/ux06-source-fixture-server.mjs`: 実UIモジュールを隔離した期限付きHTTP serverで配信し、InspectorがブラウザでP1×S1のクリック遷移を確認できる。`node tests/ui/ux06-source-fixture-server.mjs --duration 900 --port 31986`で起動し、`http://127.0.0.1:31986/#today`から「出典を開く」→`#graph?entity_id=project-atlas`を確認する。

## 6. 完了判定

コードとfixtureの回帰テストが通っても、アーキテクチャ契約の採用、実journalへのsource記録、常駐Webでの同一ペルソナ確認は完了とは扱わない。PRは判断待ちの候補として扱う。
