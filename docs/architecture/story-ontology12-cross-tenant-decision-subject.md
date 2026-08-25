# Architecture: cross-tenant Decision business subject

## 決定

既存`governs`をDecisionの業務対象関係として使う。一般の`upsert_edge`をcross-tenant対応にせず、`link_decision_subject`を追加し、DecisionからProductへの`governs`だけを許可する。

DecisionとEdgeはsource projectに残し、target Productは移動・複製しない。cross-tenant Edgeは、callerがsource/target双方へアクセスできるreadでのみ返す。

## データフロー

1. Plan requestはauthority `project_code`、target `target_project_code`、Decision/Product ID、双方のexpected version、Human Gate Receiptを受け取る。
2. Serviceはsource projectを通常tenant境界で解決し、target projectはcallerの明示project scopeとCEO roleを検証して個別に解決する。
3. Plan imageにはsource全体とtarget endpointのID・型・scope・version等の最小read modelだけを含め、target payloadやtarget project全体をexportしない。既存の`include_project_codes`は同一organization内の`rehome_entity`用であり、別organizationを対象にするこのoperationでは利用せず、source-only snapshotを必須にする。
4. Engineは`decision -> product / governs`だけを作成し、Edgeをsource projectへ保存する。
5. dry-run後、人間Bearer principalがPlan ID・before/after hash・operations・差分fingerprintへ束縛したApply専用Receiptを発行する。
6. ApplyはそのReceiptと両endpoint version、source snapshot hashをlock下で再確認する。Rollbackは作成Edgeだけを削除する。
6. Edge readはedge project accessに加え、Edge payloadの`target_project_code`とendpointのproject accessを要求する。満たさない場合はEdgeを結果から除外する。

## 不変条件

- `belongs_to_project`はアクセス・実行scope、`governs`は業務対象であり、相互に代用しない。
- cross-tenant `governs`は`decision -> product`、CEO、両project scope、Human Gateに限定する。
- cross-tenant targetはsourceと異なるorganizationに属する。単なる同一organization内のproject間移動は`rehome_entity`を使う。
- target endpointのpayloadをsource snapshot/receiptへ複製しない。
- source-only callerへtarget ID、Edge、関係の存在を返さない。
- target-only callerへsource DecisionまたはEdgeを返さない。
- dry-runは変更ではなく、Applyは別の明示承認を必要とする。

## 展開順序

1. Ontology 1.1.0の`governs`契約を検証
2. service / REST / MCP / read filterを同一SHAで展開
3. Aitle 1件のSnapshotとdry-runを作成
4. 差分提示後のみHuman Gate/Apply
