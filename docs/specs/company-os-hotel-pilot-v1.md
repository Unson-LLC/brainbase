# Story 22 最小Spec: 匿名ホテルpilot

## 目的

匿名化した一施設のfixtureを使い、Graph SSOTの目的・変数・モデル・制約、問題候補と問題snapshot、選択、下位DAG、予約・実行権限、観測・評価、学習候補・採用を一つの読み戻し可能な流れとして確認する。fixtureはOSSのローカルstoreだけを使い、外部作用は記録用の副作用なしadapterに限定する。

評価対象は `hotel-alpha`、tenantは `tenant-hotel-pilot`、単独所有者は `owner-1` とする。Objectiveの閾値は総対応負荷 `<= 100`、品質 `>= 0.90`。baselineは負荷 `140`、品質 `0.94`、実績は直接対応 `80`・引継ぎ `15`・修正 `12` から合計 `107`、品質 `0.82`、予測は負荷 `80`・品質 `0.95` と固定する。このため直接対応が減っても、v1評価は `not_achieved` となる。

## 依存と基点

- 実装repo: `Unson-LLC/brainbase`
- 実装基点: `3af12f6`（Story 09 problem selection merge後）
- 現行baseに含まれる正式なReceipt adapterとlearning adoption APIを使用する。未mergeの依存APIや別ブランチを前提にしない。
- 全ストアは同一の一時 `dataDir` に保存し、`initializePersonalOs(dataDir)` でローカル参照シナリオを初期化する。

## 正式APIと保存境界

実装は次の現行APIを直接接続する。各APIの永続化結果は同じID・版で読み戻し、fixtureの外部作用はportの記録に留める。

- Foundation／観測: `createFoundationRevisionStore({ dataDir })`、`createWorldModelStore({ dataDir, foundationStore })`。
- 候補／snapshot／選択: `createProblemCandidateStore({ dataDir, foundationStore, evidenceAccessProvider })`、`saveJudgmentProblemSnapshot`／`loadJudgmentProblemSnapshot`、`createProblemSelection`、`createProblemSelectionRecordStore({ root: dataDir })`、`evaluateProblemSelectionWithComposition`。
- 評価／Receipt: `createCompanyOsEvaluationStore({ dataDir, foundation, outcomeCase, snapshotReferenceProvider })` と `createFoundationDefinitionLoadPort(foundationStore)`。Receiptは `createCompanyOsReceiptAdapter({ dataDir, sourcePorts })` と `createOutcomeCaseReceiptSourcePort(outcomeCase)` を使い、canonical source state、owner refs、conditionsをOutcomeCase wrapperから検証する。
- 学習: `createFoundationLearningTargetPort({ foundationStore })`、`createCompanyOsLearningEvaluationPort(evaluationStore)`、`createCompanyOsLearningAdoptionStore({ dataDir, evaluation, target, runReceipt, now })`。採用済みtargetのrevisionを次runの入力とReceiptへ明示する。
- 待機／実行境界: `DurableWaitStore({ dataDir, clock, problemSnapshot })` と `createCompanyOsImpactReviewDurableWaitPort`、`createResourceReservationProblemSnapshotPort`／`ResourceReservationService`、`ExecutionAuthorityService`。reservationのsnapshot portは、ロック取得前に保存済みsnapshotを正本ローダーで読んで参照を検証し、ロック中はその読取済み参照を厳密照合する。reservationとauthorityは同一snapshotの検証後にだけfixture effect portへ進む。

## 固定する一周

1. Foundation storeにObjective、load/quality/handoff/correctionのVariable、仮説Model、二重入力を禁ずるConstraintを作成し、各定義をexact readする。
2. World modelにbaseline、直接対応、引継ぎ、回答修正、品質の観測を保存する。actual totalは保存済みの `actualDirect.value + actualHandoff.value + actualCorrection.value` から導出し、未到着値は `not_arrived` または `unknown` のまま扱う。
3. Problem candidateを保存し、selectionで今回の問題と開始・保留・停止を決める。selectionは実行権限を持たない。
4. Problem snapshotを保存し、current resolverで全参照（Objective、Variable、Model、Constraint、観測、権限、資源、期限）を検証する。観測はWorldModelのprincipal／scope／revision／digestを実読取し、権限・資源・期限・DAGはhost-ownedなfixture canonical mapとのscope／permission／revision／digest照合で解決する。未知または改竄された参照はfail closedとする。snapshotは実行許可を与えない。
5. composition APIの親DAGから、測定下位DAGと方式選択下位DAGを依存順に実行する。子が`held`／`failed`なら親を成功にしない。
6. v1のreservation・authority・effectをimpact handoff前に完了させ、同じv1のWaitが`handoff_required`になった後は旧v1のauthorityを拒否しeffect回数を増やさない。v2は新しいsnapshot／runとしてreservationとauthorityをcurrent readで検証し、effect portは外部送信せず呼び出し記録だけを返す。
7. OutcomeCaseのcurrent ACLを検証して、総負荷（引継ぎ・修正を含む）と品質を同一Objectiveのcriteriaで評価する。実行成功とObjective達成は別の結果として保存する。conditionsには `production_status: production_unproven`、`external_send: unrecorded` を保存する。
8. v1評価からModel revision 2の改訂候補を作り、validation・採用後にFoundation storeをreadbackする。次run `run-hotel-pilot-v2` は採用済みrevision 2と新しいproblem snapshotを参照し、旧 `evaluation-hotel-pilot-v1` のdigestは変えない。

## 反例と不変条件

- 証拠待ちではselection actionを`hold`とし、reservation／authority／effectを呼ばない。
- Modelの前提が反証された場合、既存のimpact-review coordinatorは`hold`を返す。同じWaitの永続化済み `run-hotel-pilot-v1`、claim、旧problem snapshotを保持したまま再評価し、`handoff_required` として新しいProblem／run `run-hotel-pilot-v2`へ渡す。ここで旧runを上書きせず、v1のsnapshot・selection・composition artifact・evaluationを不変に保つ。
- `handoff_required` 後に旧v1のreservationを再利用したauthority実行は拒否し、fixture effectは0件増加とする。v2だけが新しいsnapshot／run、承認、reservation、authorityを経てeffect portへ到達する。
- 再起動後も同じ `wait_id`、claim、problem snapshotを読み戻す。新しいProblem／runは再評価の結果として明示的に作り、旧成果物と混在させない。
- 未移行の経路や条件未記録の経路は`unknown`／未接続として結果に残す。`production_unproven` と `external_send=unrecorded` を維持し、pilotのfixture成功を顧客価値、本番稼働、実送信完了とは表示しない。

## 検証

- affected runtime: `tests/company-os-hotel-pilot.test.ts`、evaluation／receipt／learning／impact-review／durable-wait／reservation／authorityの7接続テストをまとめて実行し、8 files / 58 tests passed。
- 新テストの直接型検証: `./node_modules/.bin/tsc --ignoreConfig --noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext --strict --esModuleInterop --skipLibCheck --types node tests/company-os-hotel-pilot.test.ts` は成功。
- build確認: `npm run build` は `src/server.ts` の既存SDK署名不一致5件（行63、68、116、123、142の `TS2554: Expected 2-3 arguments, but got 1`）で失敗する。疎なworktreeで先に出たNode/MCP/tsxの依存解決エラーは、rootの既存依存をworktreeの無視対象 `node_modules` から参照して切り分けた後は再現せず、新テスト由来のbuildエラーはない。依存manifest・sourceは変更していない。
- full suiteはこのStoryの検証対象にせず、レビュー・PR・CI・merge前の状態を完了とは扱わない。
