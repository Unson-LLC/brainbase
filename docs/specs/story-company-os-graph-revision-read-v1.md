# Spec: Graph entity/edge immutable revision read

## 公開契約

`@unson/brainbase-mcp/graph-revision-reader` は、Graph entity/edgeの版付きread portと、既存の `JudgmentProblemReferenceProvider.resolveOther` 用adapterを公開する。

```ts
type GraphRevisionReference = {
  kind: 'entity' | 'edge';
  id: string;
  revision: string;
  digest: `sha256:${string}`;
  scope: { type: 'personal' | 'project' | 'organization'; id: string };
};

type GraphRevisionReadResult =
  | { status: 'resolved'; record: GraphRevisionRecord }
  | { status: 'missing' | 'unauthorized' | 'corrupt'; message?: string };
```

`GraphRevisionReader`はホストが実装する。OSSはGraph entity/edgeの履歴DB、tenant membership、organization ACLの正本を持たない。readerは要求scopeを信頼できるtenant/project boundaryへ結び付け、現在のACLとscopeを添えて返す。

## 整合性

`graphRevisionDigest`は次の値をcanonical JSON化してSHA-256化する。

```text
{ kind, id, revision, payload }
```

現在のACLは内容のdigestへ含めない。ACLの変更でrevisionを偽造せず、readごとに`currentAcl`を確認する。adapterは次をすべて満たすときだけ`resolved`を返す。

- readerのrecord identityがreferenceのkind/id/revisionと一致する。
- record digestがreference digestと一致する。
- payloadをcanonical entityまたはedgeとして検証できる。
- payloadから再計算したdigestがrecord digestと一致する。
- `currentScope`がreference scopeと一致する。
- `currentAcl`がprincipalのreadを許可する。

edge endpointが現在のGraph aggregateに存在することや、relationのendpoint typeが正しいことは、revision readerの外側にあるGraph aggregate readerの責務とする。このportは、単体edgeの形状と安定したcanonical edge IDまで検証する。

## 失敗の扱い

readerの`missing`と`unauthorized`は同じ意味へ潰さず、そのまま判断参照のstatusへ写像する。`corrupt`、不正なresolved record、digest不一致、ACL/scope metadata不正、例外は`unresolved`として閉じる。存在しないものや権限のないものを空値・成功・最新revisionへ置き換えない。

## 判断との接続

`createJudgmentProblemGraphReferenceResolver({ reader })`の戻り値を、既存の `createJudgmentProblemFoundationReferenceProvider({ resolveOther })`の`resolveOther`へ渡す。snapshotが持つentity/edge referenceは、判断開始時のdigestとscopeを保持し、save/read/historical_readの各phaseで同じ版を解決する。未知のreference kindはこのadapterが解決しない。

## 対象外

- Graph entity/edgeのDB migration、履歴生成、current revisionの推測。
- Unson organization版の認証・tenant membership・承認保存。
- 実行権限の付与、予約、deploy、外部副作用。
