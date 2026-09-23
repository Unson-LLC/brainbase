---
spec_id: company-os-evaluation-v1
story_id: story-company-os-evaluation-v1
status: implementation
spec_maturity: implementation_ready
implementation_ready: true
owner_repository: brainbase
storage_boundary: canonical_graph_plus_evaluation_sidecar
---

# Company OS 評価 v1 仕様

## 目的

この仕様は、判断時点で固定した `JudgmentProblem` を基準に、成果の達成度、予測と実績の差、判断時点の妥当性を別々に記録する。評価記録は `Objective`、`Variable`、測定値、`OutcomeCase` の正本を置き換えず、版付き参照と検証結果を保持する。

出荷・処理が成功したことと、目的の価値が実現したことは同じ結果ではない。ホテルの例では、直接対応時間が減っても、引き継ぎ・回答修正・品質低下を含む基準を満たさなければ `not_achieved` になる。予測から外れた場合も、原因を自動的に断定せず、`predictionComparisons` と `judgmentAtTimeValidity` を分離して返す。

## 所有境界と依存

- 実装は `Unson-LLC/brainbase` の OSS が所有する。
- OSS が提供する `OutcomeCasePort` は、正本の `id`・`revision`・`digest`・現在ACL・scopeを読み取るだけのportである。OutcomeCaseの閉鎖・承認・更新・組織RACIは所有しない。
- 組織側の既存OutcomeCase実装の提供候補は `brainbase-unson` の commit `40d3d8f57d463e2f22a98423d74af3b7ed1aba93`。OSS `origin/develop` の `770655c4cdb56195fa1e441455372830840f03c1` にはOutcomeCase APIは存在しない。組織APIをOSSへコピーせず、将来adapterがこのportを実装する。
- Objective・Variableの定義は canonical Graph v2 の Foundation catalogが正本である。評価sidecarに本文を複製しない。
- Problem snapshotは refsのみを保持する既存 `judgment-problem-snapshot` を使う。snapshotの `historical` readでも、現在のACLとexact revision/digestを再検証する。
- 評価記録は canonical Graph v2 と同じ `mutatePersonalOsWithSidecar` のlock・recovery・atomic commitに参加し、`evidence/company-os-evaluation.json` に保存する。独立した第二のGraph正本は作らない。

## 公開契約

`src/company-os-evaluation.ts` が次を公開する。

- `OutcomeCasePort.read(reference, actor)`：OutcomeCaseのcanonical referenceと現在アクセス情報を返す。失敗時はfail closed。
- `FoundationDefinitionLoadPort.readExact(reference, context)`：指定したFoundation revisionをdigest照合して返す。latestへ差し替えない。
- `createCompanyOsEvaluationStore(options)`：`evaluate`、`read`、`list` を持つ単独ownerの評価storeを作る。`options.snapshotReferenceProvider` は、保存済みProblem snapshotを読取時にも `historical_read` で再解決する信頼済みportである。

`EvaluationMeasurementInput` は `variableRef`、測定descriptor、`observed`／`missing`／`not_arrived`、任意の値と証拠参照を持つ。定義の異なる入力は、source/targetのexact refと、空でない変換provenanceを持つ明示的なconversionがある場合だけ受け入れる。

`CompanyOsEvaluationRecord` は次を不変記録する。

- snapshotの `snapshotId`、problem id、revision、digest
- exact Objective refとcanonical OutcomeCase ref
- prediction／actual measurement
- criterionごとの `achieved`／`not_achieved`／`indeterminate`
- criterionごとの prediction comparison `matched`／`missed`／`indeterminate`
- `judgmentAtTimeValidity`（`valid`／`invalid`／`indeterminate`）
- 評価時刻

## 評価手順

1. 信頼済みprincipalと任意のtrusted scopeを検証する。callerがObjective本文や基準本文を直接渡すことはできない。
2. Problem snapshotを `historical` で読み、snapshot idを再計算する。必須参照のprovider、現在ACL、exact digestを通す。
3. snapshotのObjectiveをFoundation catalogからexact revision/digestで読み、Objectiveのcriteriaとsnapshotのcriterion/Variable refsを照合する。
4. 各Variableの定義、valueKind、unit、aggregation、granularity、scope、evaluation periodを検証する。`at_least`／`at_most` は有限number targetとnumeric Variable、`equals` はVariableのvalueKindと一致するtargetだけを許可する。
5. OutcomeCaseをportから読み、要求されたrevision/digest、現在ACL、trusted scopeを検証する。
6. prediction／actualを正規化する。定義不一致、重複、型不一致、期間不一致は拒否する。欠損・未到来は成功値へ丸めない。
7. criterion達成、prediction comparison、judgment validityをそれぞれ計算する。実測期間の終了前、欠損、未到来を含むcriterionは `indeterminate` とする。
8. canonical lock内でGraph v2のexact Foundation revision、最新revisionの現在ACL、scope、digestを再確認し、同じ評価idがない場合だけsidecarへatomic commitする。
9. commit後に同じidをreadし、保存済みのsnapshot id・problem id・revisionをcanonical locatorへ渡して `historical` readする。snapshotの内容からdigestを再計算し、sidecarの4項目、Objective ref、criteriaのVariable refsと一致しなければ拒否する。続けてexact ref、現在ACL、測定、派生結果を再検証して返す。

## 不変条件

- 同じ評価idの異なる内容は `revision_conflict`。既存recordを上書きしない。
- 評価sidecarに保存したProblem snapshotのlocatorとdigestは、canonical snapshotの再読込で検証する。problem id、revision、snapshot id、digestのいずれかが改ざんされても、別snapshotやlatestへフォールバックせず `integrity_mismatch` で拒否する。
- sidecarのJSONが構文的に正しくても、Objective・Variable・OutcomeCaseの参照、測定descriptor、criterion、prediction comparison、achievementの再計算結果が一致しなければ読取を拒否する。
- 過去revisionを要求したrecordでも、現在のACLを再評価する。過去revisionのACLだけで失効したprincipalに公開しない。
- 現在のtrusted scopeと対象のscopeに共通subjectがなければ `scope_violation`。
- Objective／Variableが更新された場合、記録済みexact revisionをlatestへ黙って置換しない。必要なら新しいProblemと評価を作る。
- 変換なしに異なるVariable定義を比較しない。変換を使う場合はsource ref、target ref、変換根拠を保存する。
- `indeterminate` は欠測・未到来・評価期間未完了を意味し、達成または失敗へ丸めない。
- Foundation定義の登録状態や採用状態を、評価の計算だけで「真実」へ昇格させない。

## エラー境界

公開storeは `invalid_input`、`not_found`、`authorization_denied`、`scope_violation`、`integrity_mismatch`、`incompatible_measurement`、`revision_conflict`、`unsupported_graph`、`corrupt_record`、`readback_mismatch` を返す。sidecar破損、digest不一致、ACL不一致、canonical Graphの非対応版は、別保存先やlatestへのフォールバックをせず失敗する。

## 検証

`tests/company-os-evaluation.test.ts` は実際のcanonical Graph/Foundation storeとsidecarを使い、次を検証する。

- ホテル例で負荷は達成しても品質低下を含むObjective全体は未達になり、予測差分と判断妥当性が分離される。
- 欠損・未到来・未来期間が `indeterminate` になる。
- Variable revision変更を暗黙比較せず、明示conversion provenanceがある場合だけ通す。
- OutcomeCaseの現在ACL失効、trusted scope越境、sidecar JSON破損、派生結果改ざんを拒否する。
- 保存済みProblem snapshotのproblem id、revision、digestの改ざんをcanonical readbackで拒否する。
- 同一idの再評価を拒否し、commit後にimmutable recordを読み戻す。

検証コマンドは次のとおり。

```bash
npm run build
npx vitest run tests/company-os-evaluation.test.ts --reporter verbose
```

## 対象外

学習候補の採用、Objective・Model・Constraintの自動改訂、OutcomeCaseの閉鎖・承認・更新、組織providerの実装、評価UI、外部実行はこのStoryに含めない。
