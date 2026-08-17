# Canonical Entity Resolution Spec

## Invariants

- INV-1: canonical relationは表示名ではなく存在するcanonical entity IDをendpointに持つ。
- INV-2: source取得状態とentity解決状態は別field・別enumとして表現する。
- INV-3: ambiguous/unresolved mentionはcanonical entityまたはedgeを自動作成しない。
- INV-4: 全adapterは一つのResolver implementationとReceipt schemaを利用する。
- INV-5: portable receiptは入力本文、回答本文、credential、secret、個人の絶対pathを保存しない。
- INV-6: 10分の初回価値はCLI latencyではなく、導入開始から実agent出力を見た利用者の価値認識までを測る。

## Canonical graph contract

```ts
type CanonicalEntityType = 'person' | 'org' | 'project' | 'decision';

interface CanonicalEntity {
  id: string;
  type: CanonicalEntityType;
  name: string;
  aliases?: string[];
  summary?: string;
  tags?: string[];
  validFrom?: string;
  validTo?: string;
  metadata?: Record<string, unknown>;
}

type CoreRelation =
  | 'member_of'
  | 'participates_in'
  | 'accountable_for'
  | 'owned_by'
  | 'governs'
  | 'supersedes';

interface CanonicalEdge {
  id: string;
  fromId: string;
  relation: CoreRelation;
  toId: string;
  role?: string;
  context?: string;
  validFrom?: string;
  validTo?: string;
  provenance?: {
    sourceKind: 'user_approved' | 'migration' | 'import' | 'onboarding';
    sourceId?: string;
    evidenceHash?: string;
  };
}

interface GraphFileV2 {
  version: 2;
  ontology: {
    id: 'brainbase-personal-os';
    version: string;
    releaseDigest: string;
  };
  owner?: { id?: string; name?: string; summary?: string };
  entities: CanonicalEntity[];
  edges: CanonicalEdge[];
}
```

- C-GRAPH-1: `GraphFileV1 | GraphFileV2`をversionで厳密に識別する。
- C-GRAPH-2: entity ID、edge ID、`fromId|relation|toId` tupleはそれぞれ一意である。
- C-GRAPH-3: edge endpointは存在し、active Ontology relation registryのdomain/rangeに一致する。
- C-GRAPH-4: RFC 3339の`validFrom`/`validTo`は`validFrom <= validTo`を満たす。
- C-GRAPH-5: projection recordは`projectionOf?: string`でcanonical IDを参照する。参照不能なら`unresolved`でありcanonical扱いしない。
- C-GRAPH-6: Decision payloadは既存`decisions.jsonl`で読み続けられるが、Graph v2に同じIDの`decision` entityを持ち、project適用とsupersessionの正本はedgeとする。

## Resolver contract

```ts
interface ResolveTextInput {
  text: string;
  mentionSpans?: Array<{ start: number; end: number }>;
  projectScope?: {
    projectIds: string[];
    policy?: 'strict' | 'prefer_project' | 'allow_global_fallback';
  };
  asOf: string;
  entityTypes?: CanonicalEntityType[];
  source: ResolutionSource;
}

type SourceStatus = 'complete' | 'partial' | 'unavailable' | 'invalid';
type MentionStatus = 'resolved' | 'ambiguous' | 'unresolved';
type ResolutionStatus = 'complete' | 'partial' | 'none' | 'blocked';

interface MentionResolution {
  span: { start: number; end: number };
  surface?: string;
  surfaceHash: string;
  normalized: string;
  status: MentionStatus;
  selectedEntityId?: string;
  candidates: Array<{
    entityId: string;
    score: number;
    evidence: Array<
      | { kind: 'name_exact' | 'alias_exact' | 'honorific_variant' }
      | { kind: 'project_scope'; projectId: string; edgeId?: string }
      | { kind: 'relation_path'; edgeIds: string[] }
      | { kind: 'valid_at'; asOf: string }
    >;
  }>;
}
```

- C-RESOLVE-1: spanはJavaScript/JSONのUTF-16 code unit offsetで、`text.slice(start, end)`がsurfaceと一致する。
- C-RESOLVE-2: NFKC、空白、大小文字、明示alias、日本語敬称は候補生成に用いる。canonical mergeやwriteには用いない。
- C-RESOLVE-3: exact name/aliasを部分一致より優先する。
- C-RESOLVE-4: `projectId`指定時はdirect project edgeを持つ候補を優先し、scope外候補は既定で選択しない。
- C-RESOLVE-5: `asOf`で未発効または失効済みのentity/edgeを根拠に選択しない。
- C-RESOLVE-6: 同じ最上位evidence rankの候補が複数なら`ambiguous`とし、score差の捏造でresolvedにしない。
- C-RESOLVE-7: Resolverは文章からcanonical writeを行わないpure operationである。

## Portable receipt contract

```ts
interface ResolutionReceiptV1 {
  schemaVersion: 1;
  resolverVersion: string;
  graphSchemaVersion: 2 | null;
  ontology: { id: string; version: string; releaseDigest: string } | null;
  request: {
    textSha256: string;
    textLength: number;
    projectScope?: {
      projectIds: string[];
      policy: 'strict' | 'prefer_project' | 'allow_global_fallback';
    };
    asOf: string;
    entityTypes?: CanonicalEntityType[];
  };
  source: {
    authority: 'local_graph';
    status: SourceStatus;
    revisionSha256?: string;
    issueCodes: string[];
  };
  resolutionStatus: ResolutionStatus;
  mentions: Array<Omit<MentionResolution, 'surface' | 'normalized'>>;
  summary: { resolved: number; ambiguous: number; unresolved: number } | null;
  digest: string;
}
```

- C-RECEIPT-1: `unavailable|invalid` sourceでは`resolutionStatus: blocked`、`summary: null`とし、未検証を0件として解釈させない。
- C-RECEIPT-2: canonical digest payloadは`digest`自身、生成時刻、runtime path、表示用surface、正規化済みsurface、sourceの生revision・messageを除外したRFC 8785相当の決定的JSONとする。source revisionはSHA-256、問題はcodeだけを保持する。
- C-RECEIPT-3: 同じGraph revision、Resolver/Ontology version、requestから同じreceipt digestを返す。
- C-RECEIPT-4: consumerは手元のinput、`as_of`、source revisionから期待hashを照合し、span、source revision hash、digestの不一致をfail loudする。digestは自己整合性であり、署名やauthorizationではない。
- C-RECEIPT-5: Receiptはresolution evidenceであり、canonical write、外部送信、判断確定のauthorizationではない。

## Migration contract

- C-MIGRATE-1: `graph:migrate`は既定でdry-runし、4 canonical filesを一byteも変更しない。
- C-MIGRATE-2: dry-runはinput aggregate hash、planned edges、ambiguous/unresolved refs、target versionsを返す。
- C-MIGRATE-3: exactで一意なlegacy name、明示project ID、存在するDecision IDだけを自動接続する。
- C-MIGRATE-4: `--write`はlock内でaggregateを再読込し、hash mismatch、ambiguous、invalid endpointがあれば最初のwrite前に停止する。
- C-MIGRATE-5: migrationは既存4-file transaction、backup、rollback、recoveryを使い、再実行はno-opになる。
- C-MIGRATE-6: v1はread/search/get_context可能だが、edgeを保持できないwriter pathはmigration前の更新を拒否する。

## Adapter contract

- C-ADAPTER-1: 既存`get_context` fieldを保持し、additiveにGraph revision、canonical IDs、relation paths、projection statusを返す。
- C-ADAPTER-2: 既存`SearchResult`の`source,id,title,text,score`を保持し、additiveに`canonicalEntityId`、`recordClass`、`projectionOf`、`relationPath`、`authority`を返す。
- C-ADAPTER-3: CLI/MCP、議事録、Slack、判断登録、資料生成は共通Resolver outputまたはReceiptを受け取り、独自resolverを実装しない。
- C-ADAPTER-4: source adapterは`complete|partial|unavailable|invalid`を正確に渡し、空配列へ潰さない。
- C-ADAPTER-5: downstreamが旧shapeだけを理解する場合、互換projectionは追加情報を落としてもcanonical Graphを変更しない。

## Scenarios

- S-1: Atlas fixtureで田中personからAtlas projectへ`accountable_for`、判断基準decisionからAtlas projectへ`governs`がID edgeで存在する。
- S-2: `田中さんにAtlas導入の判断基準を確認する`から、敬称付きmentionが田中の同じcanonical IDへ、Atlas導入と判断基準がそれぞれ正規IDへresolvedになる。
- S-3: 同名の田中が別projectにいる場合、project scopeなしではambiguous、Atlas project scopeではAtlas側だけresolvedになる。
- S-4: `as_of`より後に発効するedgeは候補根拠に使われない。
- S-5: Graph unavailableはblocked、正常Graphで候補0件はunresolvedになる。
- S-6: legacy relationship、Personal KG、Decision projectionが同じcanonical entityへ束ねられ、canonical resultが優先される。
- S-7: Receiptのspan、text hash、source revision、candidate evidenceを改変するとverifyが失敗する。
- S-8: fresh tarball consumerの公開binとMCP stdioからS-1〜S-7の主要経路を実行できる。
- S-9: 実agentがMCP `get_context`/`search`または共通Resolverを使った本文を返し、合成ペルソナが600秒以内にBrainbase固有の価値を認識する。

## Anti-patterns

- AP-1: 人物名文字列をrelation endpointの正本として保存する。
- AP-2: `connected: true`、CLI exit 0、sample outputだけを10分の初回価値とする。
- AP-3: source unavailableを検索0件またはunresolvedへ変換する。
- AP-4: 敬称除去、部分一致、LLM推測だけでcanonical entityをmerge/writeする。
- AP-5: adapterごとにalias、confidence、scope、Receipt digestを再実装する。
- AP-6: Cycle 08証拠をCycle 09で上書きする、またはcandidate tarballとregistry公開版の証拠を混同する。

## Verification

- Unit: relation registry、edge ID、endpoint/type/cardinality、resolver normalization/ranking/scope/`as_of`、Receipt digest/verify。
- Migration: v1 dual-read、dry-run byte identity、unique/ambiguous backfill、write idempotency、rollback、recovery、concurrency。
- Writer integration: seed、project、import、connected onboardingが同じedge builderを使う。
- Public contract: legacy CLI/MCP fixtureとadditive v2 fixtureの両方を固定する。
- Consumer: generated tarballを空の一時consumerへinstallし、公開`brainbase`と`brainbase-mcp`を実processで起動する。
- Release: targeted/full test、typecheck、build、docs build、production audit、pack allowlist/integrity/gitHead。
- Value: Cycle 09を新規保存し、candidate tarballとpublished registryを別manifestへ固定する。実agent利用、具体的な回答本文、独立ペルソナ認識、600秒以内、既知Major 0件を要求する。
