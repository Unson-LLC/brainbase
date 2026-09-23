# Company OS Receipt Adapter v1

## 目的

このadapterは、既存の実行記録・成果記録・文脈取得記録・判断イベントを、Brainbaseが保持する判断参照へ読み取り専用で接続する。記録の正本や組織runtimeをOSSへ移さず、監査時に「何の記録を、どの版・hash・状態で、どの判断へ接続したか」を再現できるようにする。

実行が成功したこと、OutcomeCaseが閉じたこと、文脈を取得できたことは、Objectiveの達成や判断品質の証明ではない。adapterはこれらを別々のsource referenceとして保存し、達成・品質の判定は既存のEvaluationと判断側の契約へ委ねる。

## 所有境界

- Run Receiptは実行元runtime、OutcomeCaseは成果管理側、meeting context receiptは文脈取得側が正本を所有する。
- Decision eventは外部sourceのイベント参照として扱う。廃止済みCompanionのservice・ledger・routeをOSSへ移植しない。
- OSSは`ReceiptLinkRecord`とsourceの読み取りportを所有する。sourceの作成・更新・closure・承認は所有側のportで実装する。
- source portは現在の認可を確認してから投影を返す。adapterはsourceのraw payload、顧客情報、secretを保存しない。

## 保存と読戻し

リンク保存の前にsource portを読み、source ownerが返すcanonical referenceを保存時スナップショットとして固定する。requestのowner、state、未指定のrevision/hashは正本として保存せず、指定されたrevision/hash/conditionsだけをlookup条件として検証する。OutcomeCaseは `OutcomeCaseRead.source` の `state`・`owner_refs`・`conditions` をtrusted projectionとして使い、callerの同名値をfallbackしない。projectionが欠落・不正なら保存前にfail closedする。sidecarへの保存は`mutatePersonalOsWithSidecar`のSSOT transactionで行うが、外部portをtransaction lock内から呼ばない。

保存するsource referenceは、canonicalなkind・ID・revision・hash・state・owner reference・conditionsを不変に保持し、source snapshot digestでsidecar改変を検出する。読戻しでは同じrecordを返しつつ、source portから得た現在のstateを`source_read`へ返す。stateの変化は実行後の状態変化であり、保存時の証跡を書き換えない。read/listではkind・ID・revision・hash・owner reference・conditionsを恒久識別子として厳密に照合し、stateだけを可変値として扱う。

保存後の読戻しでsourceが見つからない、認可されない、識別子またはrevision/hashが一致しない場合はfail closedにする。sidecarのrecordを無検証のまま返して、空配列や成功へ丸めない。

## 参照の意味

`judgment_refs`はObjective、Problem、DAG、Decision、Evaluation、evidenceなどの版付き参照を保持するだけで、source記録を判断結果へ変換しない。特に`objective_status`と`judgment_quality_status`は初期値を`unrecorded`として固定する。

既存のOutcomeCasePortは、source側のread portを構成するadapterから利用できる。adapterはproviderのcanonical referenceとsource projectionをreceiptへ写像し、callerのsource metadataを信頼しない。DAG run artifactやvalue proofはsource receiptそのものへ変換せず、`evidence`または`dag`のjudgment referenceとして参照する。
