---
spec_id: company-os-judgment-view-v1
story_id: story-company-os-judgment-view-v1
status: implementation
spec_maturity: implementation_ready
implementation_ready: true
owner_repository: brainbase
storage_boundary: read_only_composition_of_canonical_ports
---

# 判断の追跡 v1 最小仕様

## 目的

判断を確認する人が、保存された結論から、判断時点の `JudgmentProblem`、Objectiveと基準、下位run、証拠参照、結果評価、判断時点の妥当性を辿れるようにする。画面は読み取り専用であり、推論途中の内部思考全文を保存・表示しない。

過去の判断の再現性を守るため、すべての参照は `historical` として受け付ける。現在のACLとexact revision/digestは再検証するが、現在の最新定義へ差し替えない。

## 所有境界と公開契約

- `src/judgment-view.ts` は保存先や認可を所有せず、Composition run、Problem snapshot、Foundation定義、DAG artifact、Evaluationを読むportを合成する。
- `src/judgment-view-http.ts` は `/judgment-views/:runId` のGETだけを扱う合成可能なhandlerである。tenant、principal、scopeは認証済みhost contextから受け、query/bodyから採用しない。
- `ui/judgment-view.js` とCSSはOSS単独で利用できる表示層である。組織版はAPI、root、認証済みcontextを注入し、member/RACI/組織選択をコピーしない。
- 欠測、未解決、権限不足、取得不能、判定不能はそれぞれ状態付きで返す。`items: []` は正本が空を確認した場合だけ使い、未確認の空配列を空成功として表示しない。

## 読取り手順

1. trusted access contextを検証し、Composition runを`runId`と照合する。
2. runのProblem snapshot locatorを`historical`で読み、snapshot id、problem id、revisionを照合する。
3. snapshotからObjectiveを一つだけ選び、Foundation storeからexact `objective` refを読む。Objective criteriaの各Variable refもsnapshotにpinされたexact revision/digestで読む。
4. Parent DAGのartifactをrun idとDAG id/versionで照合し、execution orderの最後のnode outputだけを結論として返す。artifactのnode内部やchain-of-thoughtはUIへ投影しない。
5. child runはcompleted、failed、heldを保持し、各結論、適用可能性、不確実性、証拠参照を表示する。
6. Evaluationが解決できる場合、Objective達成度・予測差分と、判断時点の妥当性を別セクションへ返す。評価がないことは未達成や妥当と解釈しない。

## 表示モデル

各セクションは `resolved`、`unknown`、`permission_denied`、`unavailable`、`undecidable`、`invalid` の状態を持つ。collectionは次の形で欠測を表す。

```ts
{
  status: 'unknown',
  items: null,
  absence_confirmed: false,
  reason: 'historical reference is unavailable'
}
```

`resolved`かつ空のcollectionだけが `items: []` と `absence_confirmed: true` を持つ。UIの正規化処理も不正な一覧要素をfilterせず、1件でも壊れていれば一覧全体を`unknown`にする。

Objectiveのcriteria、参照のtype、run/artifact/snapshotのid・version・digestは表示前に照合する。type違いを表示対象へ丸めたり、旧版が読めないときにlatestへフォールバックしたりしない。

## HTTP合成境界

```ts
type JudgmentViewHandler = (
  request: IncomingMessage,
  response: ServerResponse,
  context: { tenantId: string; principal: string; scopeId: string } | null,
) => Promise<boolean>;
```

handlerは対象外URLなら`false`を返す。対象URLのcontext欠落は401、権限不足は403、記録不正は400、取得不能は503へ写像する。reservationなどの別routeと同じlocal serverへcomposeでき、独立常駐serverを要求しない。

## 受入条件と反例

- 結論のfinal node outputと、historical Problem/Objective/Variableのexact refを同じdocumentで追える。
- Objective達成度と判断妥当性が別々に表示される。出荷・利用・価値の参照がない場合は未確認として残る。
- Objective、Variable、artifact、Evaluationのtype・revision・digest不一致を`invalid`または`unknown`で返す。
- permission denied、missing、held、indeterminateを空一覧、0件、成功、未達成へ変換しない。
- queryでtenant/principal/scopeを上書きできず、異なるtenantのrecordを返さない。
- UIで「当時版（historical）」が表示され、結論から「根拠へ移動」でevidence sectionへ遷移できる。

## 検証

純粋な正規化と表示はfixture DOMで検証する。サービスはComposition、snapshot、Foundation、artifact、Evaluationのportを組み合わせ、同一run id・同一版の照合、欠測・権限不足・不一致を検証する。HTTPはhandlerを実際のlocal serverへcomposeし、UIは実画面で結論・当時版・根拠・未確認表示をreadbackする。

```bash
npm run build
npx vitest run tests/judgment-view.test.ts tests/judgment-view-http.test.ts tests/ui/judgment-view.test.mjs tests/ui-package-contract.test.ts
```

## 対象外

判断方法やObjectiveの編集、全社指標dashboard、OutcomeCaseの更新、組織のmember/RACI/承認管理、外部実行はこの仕様に含めない。
