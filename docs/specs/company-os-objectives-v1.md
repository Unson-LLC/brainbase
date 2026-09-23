---
spec_id: company-os-objectives-v1
story_id: story-company-os-objectives-v1
status: draft
spec_maturity: implementation_ready_pending_ontology_contract
owner_repository: brainbase
storage_boundary: graph_ssot
---

# 目的と評価基準 v1 最小仕様

この仕様は、[story-company-os-objectives-v1](../stories/story-company-os-objectives-v1.md) の受入条件を、実装とテストで確認できる最小の振る舞いへ落とす。Objective と Variable は Graph SSOT の正式な意味として扱う。ただし、Graph の具体的な型名・属性名・関係名は `story-company-os-ontology-v1` が提供する共有契約に従い、本仕様から別の型定義を作らない。

## 目的

目的の責任者は、Story本文とは独立して「誰にとって、どの状態を実現したいか」と、その達成を判定するための基準を保存できる。判断の開始時に参照したObjective・Variableの版を固定し、後の更新で過去の判断条件や評価基準が変わらないことを保証する。

Objective は実現したい状態を表す。施策、Storyの完了、単一の測定値とは別の概念である。Variable は状態または成果を表す定義であり、個々の観測値ではない。観測された値は観測・イベント側から、Variable定義とその版を参照する。

## 適用境界

- 保存先はGraph SSOTのcanonical aggregateとする。既存の`mutatePersonalOs`が提供するロック、Ontology検証、原子commit、readback境界を通さない個別ファイル書き込みを公開APIにしない。
- Objective・Variableの物理表現（entity kind、edge relation、属性の最終名）はOntology Storyの共有契約を正本とする。共有契約より先に別の4型や互換表現を追加しない。
- ローカル単独所有者のOSS APIは、呼出し元が持つ認証・所有範囲のコンテキストを受け取る。リクエスト本文のowner、scope、権限フラグを信頼してアクセスを許可しない。
- 外部サービス、組織版のメンバー・承認規則、全社目標の自動生成は対象外である。組織版は認可結果をこのAPIへ渡すadapterを提供する。

## 論理データ契約

### Objective revision

Objectiveは論理IDとrevisionの組で識別する。論理IDは更新しても変わらず、revisionは1から単調増加する。更新は既存revisionを変更せず、新しいrevision全体を作る。

各revisionは少なくとも次を参照可能にする。

| 項目 | 契約 |
| --- | --- |
| subject | 目的の対象者・対象組織。対象IDまたは正規化された対象参照を使う |
| desired state | 実現したい状態。施策名やタスク一覧だけでは受理しない |
| owner | 責任者または責任組織。認可主体と同一とは限らない |
| period | 目的が評価される期間。開始・終了の意味を明示する |
| criteria | 0件以上の評価基準。各基準はVariable定義のrevision、比較方法、閾値または判定条件、評価期間を参照する |
| lifecycle | 草案・利用中・終了など、共有Ontology契約が定める状態 |
| provenance | 作成・更新の根拠と正本参照。推測で補完しない |

Objectiveのrevisionは、目的本文、criteria、Story参照のいずれかが変わっても新しくする。読み出しは特定revisionまたは最新revisionを選べる。最新を読む処理は、read開始時点の一つのrevisionを返し、複数revisionを混ぜない。

### Variable definition

Variableは「何を、対象・期間・単位・集計方法を含めてどう表すか」の定義であり、値そのものではない。少なくとも名前、意味、値の型または状態集合、対象範囲、時点または期間、単位・集計規則（該当時）を区別して保持する。未観測、未確認、欠損は0へ変換しない。

Variable definitionにも論理IDとrevisionを持たせ、更新は旧revisionを不変のまま新revisionとして保存する。ObjectiveのcriteriaはVariableの特定revisionを参照し、同じVariable論理IDの最新定義へ暗黙に追随しない。

### 草案と達成判定の可否

不完全なObjectiveまたはVariable definitionは草案として保存できる。保存成功は、達成判定に利用可能であることを意味しない。

目的の定義を判断・評価へ利用できる状態として受理するには、少なくとも次をすべて満たす必要がある。

1. Objectiveの対象、望ましい状態、責任者、評価期間が定義されている。
2. criteriaが1件以上あり、各criterionが存在するVariable definitionのrevisionを参照している。
3. 比較方法・閾値または明示的な判定条件・評価期間が欠けていない。
4. 目的と基準のrevisionが呼出し元の認可範囲で利用可能である。

これは定義のreadinessであり、観測値の存在を意味しない。実際の達成判定を開始する際には、別の入力readinessとして、参照したVariable definitionと観測値の対象・単位・期間を比較できることを検証する。観測待ち・未確認・欠損の定義を、目的定義の不備や値0へ変換しない。

この判定は`ready`という状態の文字列だけを信頼せず、保存された内容から決定的に検証する。未充足の場合、保存は成功しても achievement judgment API は「利用不可」と理由を返し、欠損値を0や未達へ変換しない。Objectiveの達成をStory完了や一つのVariable改善から推論しない。

## Story参照

ObjectiveとStoryは多対多で参照できる。各参照は共有Ontologyのtyped relationとして、次の意味を一つだけ持つ。

| link kind | 意味 | この関係だけから導けないこと |
| --- | --- | --- |
| contribution (`contributes_to`) | StoryまたはObjectiveが、別のObjectiveへの価値貢献を目指す | Story完了や下位Objectiveの達成が上位Objectiveの達成を意味しない |
| execution dependency (`execution_depends_on`) | Storyの判断・実行がObjectiveまたは別Storyの結果に依存する | 目的への貢献や時間順を意味しない |
| time condition (`time_condition`) | Storyの期限・評価時点がObjectiveの期間条件に関係する。`deadline`または`evaluation_window`と期間を明示する | Story完了が期間内の達成や実行依存を意味しない |

同じStoryとObjectiveの間に、意味が異なる複数の参照を持てる。参照の追加、削除、意味変更もObjectiveまたは関係の新revisionとして扱い、過去revisionを上書きしない。公開APIは依存関係を一つの`depends_on`へ丸めない。

### 外部Story endpointの解決

StoryはこのOSSの歴史Graph entityやFoundation catalogへ本文を複製して保存しない。`linkObjectiveStory`がIDだけでリンクを作らないよう、storeには信頼済みの`FoundationEndpointResolver`を注入できる。resolverは既存`mutatePersonalOs`のcanonical lock内で、現在のaggregate・呼出し元context・endpoint（ID、型、任意のrevision）を受け取り、次の認可メタデータだけを返す。

```ts
interface FoundationEndpointResource {
  id: string;
  type: 'story' | /* provider-owned endpoint */ string;
  revision: string;
  currentRevision: string;
  acl: { ownerId: string; visibility: string; readerIds: string[]; writerIds: string[] };
  scope: { subjectIds: string[]; validFrom: string; validUntil?: string };
}
```

返却値にStory本文、要約、private projectionを含めない。指定revisionが存在することを確認し、認可には現在revisionのACL・scopeを使う。ID不在、revision不在、resolver未設定、返却metadata不正の場合はrelationを保存せずfail-closedにする。resolverはcanonical lock外から別のaggregateを読み直して認可してはならない。

OSS単独利用では`createLocalStoryResolver`を使えるが、これはStory本文の保存先ではない。revisionごとのID・scope・ACLというadapter metadataだけを受け取り、最大revisionをcurrentとして解決する。組織版・Story providerは自分の正本から同じresolver portを実装する。越境判定は注入policy、またはtrusted contextのsubject scopeと解決済みresource scopeで行い、呼出し元がリクエスト本文に書いたowner/scopeを根拠にしない。

## 最小公開操作（論理契約）

最終的な関数名とTypeScript型は共有Ontology契約後に確定する。実装は次の操作能力を満たす。

### Objective

- `createObjective(input, authorization)`：新しい論理IDのrevision 1を保存する。草案を許可する。
- `readObjective(id, authorization, revision?)`：指定revisionまたはread時点の最新revisionを返す。越境readを拒否する。
- `updateObjective(id, expectedRevision, patch, authorization)`：expectedRevisionが現在のrevisionと一致する場合だけ新revisionを作る。旧revisionを変更しない。
- `checkObjectiveReadiness(id, revision, authorization)`：達成判定への利用可否と不足理由を返す。保存や目的の更新を行わない。
- `linkObjectiveStory(input, authorization)`：Objectiveの明示revisionとStory ID、`linkKind`を受け取り、typed linkを保存する。`linkKind`を推測・省略して受理しない。`time_condition`では期間を必須とする。

### Variable

- `createVariable(input, authorization)`：Variable definitionのrevision 1を保存する。
- `readVariable(id, authorization, revision?)`：指定revisionまたは最新revisionを返す。
- `updateVariable(id, expectedRevision, patch, authorization)`：compare-and-swapで新revisionを作る。

全操作は成功時に保存したlogical IDとrevisionを返し、直後に同じstore APIでreadbackできることを検証する。APIはGraphの内部ファイル名やrevisionの物理表現を呼出し元へ要求しない。

### 共通永続化ポート

Objective・Variable（および後続Storyが追加するModel・Constraint）は、同じ `FoundationRevisionStore` を利用する。これは個別の目的ストアを増やすためのAPIではなく、既存 `mutatePersonalOs` のcanonical aggregate lock・Ontology検証・transaction/recovery・atomic commitへ接続する共有ポートである。

```ts
interface FoundationRevisionStore {
  create(definition: FoundationDefinition, context: { principal: string }): Promise<FoundationRef>;
  read(reference: FoundationRevision, context: { principal: string }): Promise<FoundationRecord | null>;
  readLatest(type: FoundationType, id: string, context: { principal: string }): Promise<FoundationRecord | null>;
  update(input: {
    reference: FoundationRevision;
    next: FoundationDefinition;
    expectedRevision?: string;
  }, context: { principal: string }): Promise<FoundationRef>;
  list(type: FoundationType | undefined, context: { principal: string }): Promise<FoundationRecord[]>;
  addRelation(relation: FoundationRelationReference, context: { principal: string; scope?: FoundationScope }): Promise<void>;
}
```

`FoundationAuthorizationRequest.resources`には、local Foundation definitionと外部endpointの認可metadataを含める。policyへ渡す前にcloneし、Story本文を渡さない。resolverまたはpolicyが現在ACL・scopeを拒否した場合、relation追加はcanonical aggregateを変更しない。

`FoundationRef` は `id`・`type`・`revision`・`digest` を持ち、revisionの内容から決定的に計算する。Graph v2の `foundation` 拡張に版付きrecord、logical IDごとのlatest pointer、typed relationを保存し、別の `objectives.json` や sidecarを目的の正本として作らない。古いGraph v2の解釈は変えず、拡張がないGraphは空カタログとして読み出せる。Objective/Variableの固有操作は、このポートを使う薄い `CompanyOsObjectives` wrapperから公開する。

createは論理IDのrevision 1だけを作り、updateは同一write lock内で `reference.revision` を必須のCAS値として検証して次revisionを追記する。`expectedRevision`を併記する場合は `reference.revision` と一致しなければ拒否する。record、latest pointer、digestの不一致や壊れたJSONはfail-closedで読み書きを拒否する。policyが注入された場合は `context.principal` を受けた認可ポートを使い、policyがない場合も明示ACL（owner、reader、writer、visibility）で拒否する。リクエスト本文のowner・scope・権限フラグは認可根拠にしない。

Objective/Variable固有APIはこのポートの薄い型付きwrapperとして公開し、最新revisionの暗黙混在、観測値の目的本文への複製、Graphのatomic境界を迂回する書込みを許可しない。

## 版管理と同時更新

- 既存revisionを上書き、削除、内容差替えしない。
- updateには`reference.revision`を必須のCAS値として渡す。`expectedRevision`を使う場合は同じ値を重複指定し、省略、非正数、既存のcurrent revisionとの不一致は`revision_conflict`として拒否する。
- compare-and-swapの比較と新revisionのcommitは、SSOTの同一write lock内で行う。lock外で先に読んだ値を使って更新しない。
- 競合拒否時はGraph、参照、revision pointerを一切変更しない。呼出し元には現在revisionを推測せず、conflictとして返す。
- 旧revisionのreadbackは、新revision保存後もbyte/意味の両面で同じ内容を返す。過去の判断・評価は旧revisionを参照し続けられる。

## 権限・越境境界

authorizationは実行時に解決された信頼済みコンテキストであり、少なくともowner scope、読書き権限、対象resource scopeを含む。次の場合は`authorization_denied`または`scope_violation`として、保存前に拒否する。

- 読み出すObjective・VariableまたはStoryが呼出し元のscope外にある。
- 更新主体に対象resourceのwrite権限がない。
- リクエスト本文のowner/scopeが、解決済みコンテキストと一致しない。
- Objectiveが参照するVariableまたはStoryのscope境界を越える。

拒否はGraphやsidecarの一部も変更しない。認可判断を、Graphに保存された目的本文や、callerが送った`authorized: true`のような値から再構成しない。

## 保存・readback・障害境界

1. 入力とauthorizationを検証する。
2. Objective/Variableの参照とrevisionを正規化し、最新aggregateをSSOT lock内で読む。
3. ontology validation、scope validation、expectedRevision compareを行う。
4. 完全な次aggregateを作り、既存のatomic commitで公開する。
5. commit後、同じstore APIで保存したID・revisionをreadbackし、返却値を確定する。

検証、権限、競合、Ontology、storageのいずれかが失敗した場合は成功値を返さず、以前のaggregateを維持する。部分的なGraphやリンクを「保存済み」と扱わない。既存の`mutatePersonalOs`が提供する recovery/error 境界を迂回する sidecar を新しい正本として追加しない。

## 受入シナリオ

1. 完全なObjectiveとVariable definitionを保存し、同じID・revisionを新しいstore読込で取得できる。
2. 対象、望ましい状態、owner、periodが欠けたObjectiveを草案として保存できるが、readinessは不可と不足理由を返す。
3. criterionのthreshold、Variable定義、観測値のいずれかが欠ける場合、欠損は0にならずreadiness不可になる。
4. 一つのObjectiveへ複数Storyを異なるlink kindで参照し、一つのStoryから複数Objectiveを参照できる。別kindを同一`depends_on`に丸めない。
5. ObjectiveまたはVariableをupdateし、revisionが1増え、旧revisionのreadbackが不変である。
6. staleなexpectedRevisionで同時更新を行い、一方だけが成功し、もう一方は`revision_conflict`でGraphを変更しない。
7. scope外のread/writeと未許可writeを実行し、`authorization_denied`または`scope_violation`で拒否され、Graphを変更しない。
8. commit後に新しいプロセスからreadbackし、保存結果、revision、Story参照、Variable revisionを確認する。

## 対象外・禁止事項

- Story完了、実行成功、単一の指標改善からObjective達成を自動確定すること。
- 未確認の観測、仮説、欠損値を正式なObjective/Variableの内容へ推測で昇格すること。
- 同じ論理IDの旧revisionを最新値で書き換えること。
- `depends_on`一つで貢献、実行依存、時間条件を表すこと。
- Objective本文に達成基準を複製して別の正本を作ること。criteriaはVariable定義revisionを参照する。
- Graph SSOTの原子commitを迂回した個別JSON書込み、未認可のscope指定、認可拒否後の部分保存。

## 検証コマンドと証拠

共有Ontology型の実装後に、次を最小検証とする。

- `npm run build`
- Objective/Variableの型・validator・保存APIのfocused test
- `tests/ssot-atomic.test.ts` の既存原子commit/recovery test
- 実際のtemporary data directoryを使うcreate/update/readback E2E（新しいプロセスを含む）
- Story参照の多対多・3種link kind、草案readiness、旧revision不変、競合、権限拒否のnegative test

テストが未作成、readback未確認、またはshared ontology契約未確定の状態を、実装済み・検証済み・完了とは扱わない。
