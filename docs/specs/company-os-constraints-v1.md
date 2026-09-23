---
spec_id: company-os-constraints-v1
story_id: story-company-os-constraints-v1
status: draft
spec_maturity: implementation_ready_pending_ontology_contract
owner_repository: brainbase
storage_boundary: injected_versioned_store
---

# 判断に適用する制約 v1 最小仕様

この仕様は、[story-company-os-constraints-v1](../stories/story-company-os-constraints-v1.md) の受入条件を、実装とテストで確認できる最小の振る舞いへ落とす。ConstraintのGraph上の型・関係・属性名は `story-company-os-ontology-v1` が提供する共有契約を正本とする。本Specの `ConstraintProjection` はその共有型を resolver へ渡す構造的なread/write境界であり、4型の別正本を作らない。

## 目的

判断を開始する前に、今回の所有範囲・対象・時点へ適用できる制約と、その制約を採用したDecisionの版を読めるようにする。制約の登録や採用は実行権限を生成せず、未解決・競合・認可不明は許可へ変換しない。

## 最小データ境界

Constraintは論理IDと版の組で識別する。更新は既存版を変更せず、新しい版を追加する。共有Ontologyが提供するcanonical Constraintを次の投影契約へ適合させる。

| 項目 | 契約 |
| --- | --- |
| `id`, `revision` | 論理IDと正本が定める版。旧版は不変。版の採番はstoreまたは注入されたrevision sequenceに従う |
| `acl.ownerId` | 参照・書込みの所有境界。callerの認証済みcontextと一致する必要がある |
| `meaning`, `adoptionState`, `authorizedUses` | 制約の意味、採用状態、判断などへの利用範囲。状態・予測をConstraintへ変換しない |
| `condition` | 定性的な条件文。真偽、適用可否、競合の判定はこの文字列を解釈せず、注入されたevaluation providerへ委ねる |
| `appliesTo`, `scope` | 明示的な対象IDと対象・時点の範囲。対象を省略した場合に全体へ拡張しない |
| `scope.validFrom`, `scope.validUntil` | RFC3339の半開区間 `[validFrom, validUntil)`。終了時刻は任意 |
| `adoptionBasis` | 採用済みDecisionの論理IDと版の配列。指定版が読めないConstraintは解決へ適用しない |

例外はConstraintの版に対する別記録で、承認主体、対象範囲、有効期限、理由、適用対象のConstraint版を含む。例外の保存は、注入された認可portが許可した場合だけ成功する。

## 公開境界（共有Ontology契約確定後に型aliasを結ぶ）

実装が所有するのは次のresolver/store/authorization portである。`ConstraintProjection` は共有OntologyのConstraint型へaliasまたはadapterで接続し、同じ型の別Graph正本は追加しない。

```ts
interface ConstraintStore<TConstraint extends ConstraintProjection = ConstraintProjection> {
  append(input: { record: TConstraint; expectedPreviousRevision?: string | null }, context?: ConstraintAuthorizationContext): Promise<TConstraint>;
  get(ref: { id: string; revision: string }, context?: ConstraintAuthorizationContext): Promise<TConstraint | null>;
  getLatest(id: string, context?: ConstraintAuthorizationContext): Promise<TConstraint | null>;
  list(query: ConstraintStoreQuery, context?: ConstraintAuthorizationContext): Promise<readonly TConstraint[]>;
  appendException(exception: ConstraintExceptionRecord, context?: ConstraintAuthorizationContext): Promise<ConstraintExceptionRecord>;
  listExceptions(query: ConstraintExceptionQuery, context?: ConstraintAuthorizationContext): Promise<readonly ConstraintExceptionRecord[]>;
}

interface ConstraintAuthorizationPort {
  authorize(request: ConstraintAuthorizationRequest): void | Promise<void>;
}

interface DecisionRevisionReader {
  exists(reference: ConstraintDecisionReference, context: ConstraintAuthorizationContext): Promise<boolean>;
}

interface ConstraintEvaluationProvider<TConstraint = ConstraintProjection> {
  evaluate(input: {
    constraint: TConstraint;
    candidates: readonly TConstraint[];
    query: ConstraintResolutionQuery;
    activeExceptions: readonly ConstraintExceptionRecord[];
  }): Promise<
    | { status: 'resolved'; applies: boolean; reason?: string }
    | { status: 'unknown'; reason: string }
    | { status: 'conflict'; reason: string; conflictingRefs?: readonly ConstraintRef[] }
  >;
}
```

組織のrole・member・承認規則はこのportの実装に注入する。OSSにはorganization administrationを持ち込まない。OSSの単独所有者検証は `ownerId === actorId` と境界一致だけを確認する。

## 解決規則

`resolveConstraints(query, context)` は、指定owner・対象・時点に適用する版だけを取得する。

1. `asOf`、owner、対象の境界を必須として検証する。ownerの不一致、未知の対象範囲、越境参照は `unresolved` とし、空結果に丸めない。
2. `validFrom <= asOf < validUntil` を満たす版だけを候補にする。時間外の版は適用候補にしない。
3. `adoptionBasis` がなく、またはDecisionの指定版が読めない候補は `decision_reference_missing` / `decision_reference_unresolved` とする。
4. 条件の適用可否と競合は、候補・対象・例外を受け取るevaluation providerの結果だけで決める。providerが `unknown` または `conflict` を返す場合は理由付き `unresolved` とする。`condition` を比較して競合を自動推論しない。
5. 期限切れの例外は無視して元のConstraintを評価する。現行例外が対象・期限・承認主体を満たさない場合は `unresolved` とする。
6. `authorizedUses` と `adoptionState` を確認する。意味を保持して返すが、Constraintの解決結果から実行許可・禁止を自動生成しない。
7. 結果には `executionAuthority: 'not_granted'` を常に付ける。Constraintの登録・採用・例外保存は外部作用を許可しない。

## 版競合と保存境界

`append` は同一IDの現行版と `expectedPreviousRevision` を同じストア操作で比較する。新規IDは `null` を指定する。不一致は `revision_conflict` とし、旧版・新版本体を変更しない。成功後は同じIDと版を `get` でreadbackし、保存内容の不一致を `store_corrupt` としてfail loudする。

## 受入シナリオ

1. Constraintを版1として保存し、同じID・版のreadbackで条件・scope・期間・採用Decision版が不変である。
2. 版1を更新して版2を保存し、版1のreadbackが変わらない。staleなexpected revisionは `revision_conflict` で拒否する。
3. owner・target・asOfが一致するhard constraintだけを解決し、preferenceを禁止と扱わない。
4. state/prediction相当の情報をConstraintへ偽装した不正な型・必須属性、未採用Decision、Decision版の不存在は保存または解決を未解決理由付きで止める。
5. evaluation providerの `unknown` / `conflict`、未知のscope、越境参照を `unresolved` とし、許可を返さない。
6. 例外はapprover、scope、expiry、rationale、Constraint版を保持し、single-ownerまたは注入portの認可なしに保存できない。期限切れ例外は制約を復活させる。
7. Objective/Constraintの登録・採用結果は実行authorityを発生させない。

## 対象外

- 組織のmember・role・RACI・承認台帳の実装
- 条件式の実行評価、資源予約、外部作用の開始
- 全社ポリシーの自動制定、ConstraintとObjectiveの自動合算
- Graph SSOTの4型の別定義やpackage exportの変更

## 検証

- `npm run build`
- `npm run test:run -- tests/constraint-resolution.test.ts`
- `scripts/graphify-impact-context.mjs` のlookup結果を `.vibepro/graphify/` に保持する

`FoundationConstraintStore` はObjective Storyの `FoundationRevisionStore` へConstraint本体のcreate/read/update/listを接続し、既存PersonalOsの原子commitを迂回する個別Graphファイルを作らない。Foundation storeの認証主体はresolverのowner contextから渡す。例外に必要な承認者・期限・理由は、共有Ontologyの現行 `ConstraintException` にないため、canonicalな証跡／実行側の `ConstraintExceptionStore` を注入する。実装が未接続のまま例外をローカルsidecarへ保存することは許可しない。共有契約が拡張された場合はこのadapterをその保存操作へ差し替える。
