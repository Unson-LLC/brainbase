# Spec: Philosophy canonical revision read

## 公開契約

`philosophy-revision-reader` は、既存の哲学正本を保存せずに版付きで読むためのhost portと、既存の `JudgmentProblemReferenceProvider.resolveOther` 用adapterを公開する。

```ts
type PhilosophyRevisionReference = {
  kind: 'philosophy';
  id: string;
  revision: string;
  digest: `sha256:${string}`;
  scope: { type: 'personal' | 'project' | 'organization'; id: string };
  valid_from: string;
  valid_to?: string | null;
};

type PhilosophyRevisionRecord = {
  kind: 'philosophy';
  id: string;
  revision: string;
  digest: `sha256:${string}`;
  payload: JudgmentProblemJSONValue;
  applicability: {
    scope: { type: 'personal' | 'project' | 'organization'; id: string };
    validFrom: string;
    validUntil?: string;
  };
  currentAcl: FoundationAcl;
  currentScope: { type: 'personal' | 'project' | 'organization'; id: string };
};
```

The host owns the canonical philosophy source, revision history, current ACL, and tenant membership. The reader receives the requested reference, resolver phase, principal, and requested scope. It may return a historical payload only after applying the current authorization boundary.

## 整合性

`philosophyRevisionDigest` は `kind`・`id`・`revision`・opaqueな`payload`・`applicability`をcanonical JSON化してSHA-256化する。現在のACLとcurrent scopeは内容のdigestへ含めず、readごとに検証する。adapterは次をすべて満たすときだけ `resolved` を返す。

- readerのrecord identityとdigestがreferenceへ一致する。
- payloadとapplicabilityが構造的に正しく、再計算したdigestがrecord digestへ一致する。
- currentScopeが要求scopeと一致し、currentAclがprincipalのreadを許可する。

`save` と現在の `read` では、applicabilityのscopeがreference scopeと一致し、適用期間がreference期間を包含することも確認する。`historical_read` は過去の適用可否を現在の条件で再判定せず、固定されたreferenceのdigest、recordの構造、現行ACL、current scopeだけを確認する。

## 失敗の扱い

readerの`missing`と`unauthorized`はそれぞれ同じstatusへ写像する。`corrupt`、不正なresolved record、digest不一致、ACL/scope/期間metadata不正、reader例外は`unresolved`として閉じる。未知のreference kindはこのadapterが解決しない。

## 判断との接続

`createJudgmentProblemPhilosophyReferenceResolver({ reader })`を、既存の `createJudgmentProblemFoundationReferenceProvider({ resolveOther })`へ渡す。snapshotは哲学の正本を複製せず、ID・版・digest・scope・期間を保持する。save/read/historical_readの各phaseで同じ版を解決し、現行ACLを再確認する。historical_readでは参照時点の適用条件を保存したreferenceの一部として扱い、現在のapplicabilityで過去判断を再評価しない。

## 対象外

- 哲学正本の保存・revision発行・承認・tenant membership。
- 哲学をObjective、Variable、Model、Constraintへ変換すること。
