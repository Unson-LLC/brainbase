---
spec_id: company-os-world-model-v1
story_id: story-company-os-world-model-v1
status: draft
spec_maturity: implementation_ready
owner_repository: brainbase
storage_boundary: graph_foundation_plus_atomic_evidence_sidecar
---

# 世界モデル v1 最小仕様

この仕様は、[story-company-os-world-model-v1](../stories/story-company-os-world-model-v1.md) の受入条件を、既存の共通Ontology契約とGraph SSOTの保存境界に接続する最小の振る舞いへ落とす。`variable` と `model` の定義は共有Ontologyの版付き定義を参照し、観測レコードだけが値を保持する。世界モデルの実装は会社全体のシミュレーターや時系列基盤を作らない。

## 保存の責務

- Variable定義とModel定義は、共有Ontologyが定める `id + revision` の版付き定義としてGraph SSOTのfoundation catalogへ保存する。
- 観測値は、Variable定義を `variableRef: { id, type: "variable", revision }` で参照する不変レコードとして保存する。値をVariable定義へ埋め込まない。
- Modelの根拠は `provenance` のsource/evidence参照で保持する。formal modelへ採用しても、candidate起源、元仮説、根拠、ACL、未検証状態を別のadoption recordで保持する。
- 保存・更新は既存のSSOT aggregate lock/atomic commit境界を通る。観測・採用の証拠記録は独立writerを持たず、同じトランザクションでコミットされる証拠サイドカーへ保存する。

定義の保存はObjective担当の`FoundationRevisionStore`へ委譲する。観測・候補採用の記録は、`mutatePersonalOsWithSidecar`でGraph v2のaggregateと同時に保存する`evidence/world-model.json`へ置く。これは独立した正本やロックではなく、Graph定義と同じSSOTトランザクションに参加する証拠記録である。保存先が分かれて見えても、Variable／Model定義とその記録は`id + type + revision`およびdigestで接続する。

書き込みは次の順序で行う。

1. lock外で入力、参照権限、定義との互換性を検証し、参照した定義の`id + revision + digest`を得る。
2. `mutatePersonalOsWithSidecar`のlock内で、渡されたcurrent aggregateのfoundation catalog helperから同じ定義と最新revisionのACLを解決する。FoundationStoreの通常の`read`をcallback内で再呼出ししない。
3. lock内でdigest、型、ACL、適用範囲、値の互換性を再検証してから、観測または採用記録を証拠サイドカーへ追加する。`mutatePersonalOsWithSidecar`がcallbackへ渡す既存サイドカー内容を読み、Graph aggregateと同じcommitへ渡す。読み出しは`readPersonalOsSidecar`を使い、独自lockやcallback内のsidecarファイル再読込を行わない。

期待digestが一致しなければ`revision_conflict`として書き込まず、事前のread結果をそのまま信頼しない。現行revisionのACLも同じaggregateから再確認する。

## 観測レコード

観測は次を必須とする。

| 項目 | 契約 |
| --- | --- |
| `id` | 不変の観測ID。訂正は新しいIDで保存する |
| `variableRef` | Variableの論理IDとrevision。最新定義へ暗黙追随しない |
| `subjectId` | 何を観測したかを表す対象ID |
| `value` | VariableのvalueKindに対応する値。未観測・未確認・欠損は0へ変換しない |
| `occurredAt` | 事象が発生した、または値が有効になった時点 |
| `period` | 値が表す期間。単一時点でも `from` と `until` を保持する |
| `recordedAt` | Brainbaseが記録した時点。後日取り込まれた場合も発生時点と混同しない。実観測では`occurredAt`より前を許可しない |
| `sourceRef` | 出典ID・種別・証拠参照。出典なしで観測済みとは扱わない |
| `supersedes` | 訂正時だけ旧観測IDを参照する。旧観測を上書きしない |

読み出しは観測IDを指定して元のレコードを復元できる。`supersedes` は現在値の探索に使えても、過去の判断が固定した観測参照を差し替えない。

将来時点の予測は観測レコードへ混ぜない。予測はModel／run側の予測記録として、予測時点と実績観測を別の参照で保持する。

## Model定義と候補採用

Modelは共有Ontologyの版付き `ModelDefinition` を使い、少なくとも入力Variable、出力Variable、適用範囲、定性的関係または式、不確実性、根拠、検証状態を保持する。`adoptionState` と `epistemicState`／`validationState` は別の軸であり、採用済みでも未検証のModelを検証済みとは表示しない。

candidateをformal modelへ採用するときは、次を一つの不変adoption recordへ保存する。

- candidate ID と元の仮説本文
- candidateが持っていたevidence参照
- candidate時点のACL
- formal modelの `id + revision`
- 採用時点の用途・範囲・承認参照
- formal modelの未検証状態

採用は仮説の真実化ではない。candidateの本文やACLをformal modelの現在値で上書きして、元の状態を失わせない。

## 公開操作

共有storeの最終関数名はObjective/ontologyの契約に従う。world-modelモジュールは、次の純粋な検証・変換能力を提供する。

- `normalizeWorldModelObservation(input)`：時刻、期間、Variable revision、値、出典を検証し、配列を複製した不変レコードを返す。
- `validateWorldModelObservation(observation, variable)`：Variable定義との型・単位・対象範囲・期間の不整合を具体的なIssueへ返す。
- `retainCandidateModel(candidate, model, adoption)`：元仮説・証拠・ACLを残した採用記録を作る。modelの検証状態を自動昇格しない。
- `validateWorldModelModel(model, use)`：共有OntologyのModel契約を利用目的ごとに検証する。関係・入力宣言から因果や正確性を推論しない。

永続化は`createWorldModelStore({ dataDir, foundationStore })`で canonical Graph SSOTへ接続する。最小の永続化操作は次のとおり。

- `createVariable(variable, context)`／`createModel(model, context)`：共有`FoundationRevisionStore.create`へ委譲する。world-modelは独自の定義カタログを持たない。
- `readModel(reference, context)`：指定revisionだけを読む。最新revisionへの暗黙追随はしない。
- `saveObservation(input, context)`／`readObservation(id, context)`／`listObservations(query, context)`：`evidence/world-model.json`へ不変観測を保存・復元する。
- `saveModelAdoption(candidate, modelRef, adoption, context)`／`readModelAdoption(id, context)`／`listModelAdoptions(context)`：同じ証拠サイドカーへcandidateのスナップショットとformal Modelの参照を保存・復元する。

観測・採用レコードの読み出しでも、定義参照のACLと候補ACLを確認する。candidateの`evidenceIds`と出典参照は保存するが、制限されたevidence本文をcandidateやGraph aggregateへ複製しない。永続化APIはObjective担当のfoundation catalog storeを利用し、world-model独自の版管理・ロックを追加しない。公開exportは既存package surfaceへ追加するが、独立した保存契約やロック境界は公開しない。

## 受入シナリオ

1. 同じVariable `id + revision`を参照する観測を保存し、対象・値・発生時点・期間・記録時点・出典を新しいstore読込で復元できる。
2. Variableのrevisionを更新しても、旧観測は旧revisionを参照したまま変わらない。旧観測を新定義で再解釈する場合は明示的な変換記録を作る。
3. 発生時点より後に記録された観測を読み、`occurredAt`と`recordedAt`が別の値として保持される。
4. 訂正観測は新IDと`supersedes`で保存し、過去判断の旧観測IDから元の値・出典・時刻を復元できる。
5. candidate由来のModelを採用し、元仮説・evidence・ACL・未検証状態が残る。`adoptionState=approved`だけを理由に`epistemicState=verified`へ変換しない。
6. Modelの入力・出力・適用範囲・関係または式・不確実性・根拠が欠けた場合、保存前に具体的なIssueを返す。欠損値を推測で補わない。
7. 定義をlock外で参照した後に同じrevisionのdigestが変わった場合、atomic callback内の再確認で`revision_conflict`になり、観測や採用レコードは追加されない。

## 禁止事項

- Variable定義と観測値を一つのレコードへ混在させること。
- 同じVariable論理IDの最新revisionを既存観測へ暗黙適用すること。
- 訂正観測で旧レコードを上書き、過去判断の参照を失わせること。
- Model採用、承認、入力／出力宣言から真実・因果・正確性を導くこと。
- Graph SSOTのatomic commitを迂回する独立sidecar writer・独立lockを追加すること。
- `FoundationRevisionStore.read`を`mutatePersonalOsWithSidecar`のcallback内から呼び、同じSSOT lockを再取得すること。
- lock外で行ったACL・revision・digest検証の結果だけを、lock内の再確認なしに採用すること。
