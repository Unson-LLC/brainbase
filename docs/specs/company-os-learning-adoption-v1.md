---
spec_id: company-os-learning-adoption-v1
story_id: story-company-os-learning-adoption-v1
status: implementation
spec_maturity: implementation_ready
implementation_ready: true
owner_repository: brainbase
storage_boundary: canonical_graph_plus_learning_adoption_sidecar
---

# Company OS 学習採用 v1 仕様

## 目的

この仕様は、評価結果から作った改訂候補を、候補・検証・採用・次回runでの利用に分けて保存する。結果との差分だけでモデルを誤りと確定せず、測定誤差・実行差・外部変化を根拠付きで記録する。採用は許可された新版を作る操作であり、未検証の定義を検証済みへ昇格させたり、進行中のrunへ新版を注入したりしない。

## 所有境界と依存

- 実装は `Unson-LLC/brainbase` のOSSが所有する。共通の候補・検証・採用・次回run利用の記録と、単独所有者の検証を提供する。
- 評価の読み取りはStory07の `CompanyOsEvaluationStore.read` を `LearningEvaluationPort` として使う。提供元の評価recordを複製せず、`id` と `sha256` digestのexact参照だけを保存する。Story07の採用commitは `7e6359681af6606e14cba8ca8116ca559504e900` である。
- 組織固有のメンバー・役割・承認規則、`judgment_method`／`execution_method` の正本はOSSが所有しない。これらは `LearningAdoptionAuthorizationPort` と `LearningTargetPort` を実装する組織または利用側providerから受け取る。組織側のOutcomeCaseやRACIをOSSへコピーしない。
- OSSのObjectiveとworld model（Foundationの`model`／`variable`）は、canonical Graph v2のFoundation catalogを正本として `createFoundationLearningTargetPort` から参照する。Graphの履歴を別の目的正本へ複製しない。
- 候補・検証・採用・run利用の参照記録は `evidence/company-os-learning-adoption.json` に置く。このsidecarは `mutatePersonalOsWithSidecar` のcanonical lock・recovery・atomic commitへ参加し、Foundation Graph変更と同じcommit境界で更新する。
- brainbase-unsonの Knowledge Event Cycle（`f8f777f2`）、Memory Promotion Kernel（`44368a2d`）、Meeting Judgment Learning（`c320cdc0`）は設計参照候補であり、OSSはそのデータ・API・組織権限を取り込まない。

## 公開契約

`src/company-os-learning-adoption.ts` は次を公開する。

- `createCompanyOsLearningAdoptionStore(options)`：学習記録storeを作る。`evaluation`、`target`、任意の`authorization`、canonical `dataDir`を受け取る。
- `createCandidate`／`readCandidate`：評価のexact digest、対象のexact revision、grounds、counterexamples、uncertainty、applicabilityを持つ候補を保存・読取する。
- `createValidation`／`readValidation`：候補に結び付くfinding、結論、model disposition、basisを保存・読取する。`refuted`は`other`だけのfindingでは登録できず、予測差だけで反証しない。
- `adopt`／`readAdoption`：候補と検証のdigestを再確認し、現在のACL・scopeと採用権限を検証して、新しいtarget revisionと採用recordを同一canonical lock内で作る。
- `recordRunUse`／`readRunUse`：`planned` runへ採用版を選んだ事実だけを、adoptionとは別のimmutable recordとして残す。開始済みrunへの自動注入APIは提供しない。
- `createCompanyOsLearningEvaluationPort`：Story07評価storeを読み取り専用portへ適合する。
- `createFoundationLearningTargetPort`：OSSが所有するObjective／world modelのFoundation targetを提供する。判断方法・実行方法のproviderは別実装とする。
- `LearningTargetPort.prepareRevision` はlock外で外部読み取り・検証を行い、`commitRevision` はlock内で同期的にexact CASを行う純粋なcommit契約とする。commit中のネットワーク呼出しやSSOT再入を許さない。

各recordはcatalog versionとcanonicalized JSONの`sha256` digestを持つ。同じIDやidempotency keyへの同一内容の再試行は冪等だが、異なる内容は`revision_conflict`として拒否する。

## ライフサイクル

1. 信頼済みprincipalで評価recordを読み、入力された評価ID・digestが現在読める正本と一致することを確認する。
2. 候補に変更先のkind／ID／revision／digest、提案変更、根拠、反例、不確実性、適用範囲を保存する。候補は真実や採用済み定義へ変換しない。
3. 候補を参照する検証recordに、`measurement_error`、`execution_difference`、`external_change`、`other` のfindingと結論・model disposition・根拠を保存する。
4. 採用時は候補と検証のexact digest、対象の現在exact revision、現在ACL、scope、採用権限を確認する。対象providerがlock外で次のrevisionを準備し、lock内で対象の現在revisionを再確認する。
5. CASに成功した場合だけ、Foundation targetの新版と採用recordをcanonical Graph v2＋sidecarへatomic commitする。既存revision、候補、検証、過去runは上書きしない。
6. 採用された版を次の`planned` runが使う場合、採用recordのexact target参照をrun-use recordへコピーする。採用と実利用は別々に読み戻せる。

## 不変条件

- 対象kindは`world_model`、`judgment_method`、`execution_method`、`objective`の4種を表現できる。OSS Foundation adapterが実装するのはObjectiveとworld modelの`model`／`variable`で、未提供のmethod targetは`unsupported_target`で失敗する。
- `judgment_method`／`execution_method`へ組織固有の正本や権限を推測してフォールバックしない。provider未指定の外部targetはfail closedとする。
- 過去revisionを参照するrecordでも、read時は現在のACLとscopeを再評価する。過去revisionに残ったACLだけで現在失効したprincipalへ公開しない。
- 対象の新版は同じlogical ID・kind・Foundation typeを維持する。ACLとscopeを採用候補から変更できず、Modelの`validationState`も変更できない。未検証Modelの採用は未検証のまま残る。
- 採用準備後に対象が別revisionへ進んだ場合は`revision_conflict`でatomic commit全体を拒否する。sidecarだけ、Graphだけの片側commitを作らない。
- sidecarの構文が正しくても、record digest、候補・検証の参照、採用targetのexact digestが不一致なら`corrupt_record`または`integrity_mismatch`で読み取りを拒否する。
- 同一adoptionのidempotency keyを異なる候補・検証・principalで再利用できない。run-useも同じIDに異なるrun・adoption・principalを登録できない。
- `readAdoption`と`readRunUse`は参照先の現在ACLを通し、採用・run利用のrecordだけを根拠に対象本文や権限を復元しない。
- 採用は目的・世界モデル・判断方法・実行方法の更新先を混同しない。Objective変更の権限は対象のproviderへ戻し、候補や検証の保存権限から自動的に付与しない。

## エラー境界

公開storeは`invalid_input`、`not_found`、`authorization_denied`、`scope_violation`、`revision_conflict`、`integrity_mismatch`、`invalid_validation`、`unsupported_target`、`corrupt_record`、`readback_mismatch`を返す。破損、ACL失効、scope越境、exact digest不一致、対象provider欠落時に別storeやlatestへフォールバックしない。

## 検証

`tests/company-os-learning-adoption.test.ts` は実際のcanonical Graph v2／Foundation storeとsidecarを使い、次を検証する。

- ホテルのworld model候補に根拠・反例・不確実性を保存し、外部変化をfindingにした検証から新版を作る。採用後もModelの`unverified`を維持し、旧revisionのdigestを変更しない。
- `other`だけのfindingで`refuted`を登録できず、measurement errorを含む検証なら登録できる。readerの採用を現在ACLで拒否する。
- 対象revisionが採用前に進んだ場合は`revision_conflict`で失敗し、sidecarの不正追記は`corrupt_record`でfail closedする。
- planned runの同一利用は冪等であり、別内容の再利用は拒否する。

検証コマンドは次のとおり。

```bash
npm run build
npx vitest run tests/company-os-learning-adoption.test.ts --reporter verbose
```

## 対象外

組織固有の承認provider、judgment／execution methodの正本、評価recordやOutcomeCaseの更新、目的・モデルの自動真実化、進行runへの新版注入、UI、外部実行はこのStoryに含めない。
