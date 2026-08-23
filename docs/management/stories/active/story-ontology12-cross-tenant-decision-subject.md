# Story: Decisionの業務対象をテナント境界を越えて安全に参照する

## 利用者価値

Graph管理者として、Decisionのアクセスscopeを変えずに、その判断が規律するProductを正確に表し、許可のないtenantへDecision本文や関係の存在を漏らさず、安全なdry-runを確認してから適用したい。

## 背景

`dec_aitle_call_public_name_20260522`はBrainbase projectに保存され、業務対象はTechKnight tenantの`product_techknight_aitle`である。`rehome_entity`は同一organization内の実行scope移動に限定されるため、このDecisionをAitleへ移すのはアクセスscopeと業務対象を混同する。

Ontology 1.1.0にはDecisionからProductへの`governs`が既にある。今回はOntology型を増やさず、この既存関係をcross-tenantで保守するときの認可・可視性・監査契約を追加する。

## 受け入れ条件

- [ ] AC-001: Ontology 1.1.0の既存契約どおり、`belongs_to_project`をアクセス・実行scope、`governs`をDecisionの業務対象として区別する。
- [ ] AC-002: cross-tenant `governs`作成はsource/target両projectへの明示アクセス、CEO role、Human Gate Receipt、双方のexpected versionを必須にする。
- [ ] AC-003: Edgeはsource projectに保存し、Decision/Product本体を複製・移動しない。
- [ ] AC-004: read pathはCEO roleかつcallerがsource/target双方へアクセスできる場合だけcross-tenant Edgeを返し、GM以下または片側scopeではEdgeの存在とtarget IDを返さない。
- [ ] AC-005: Plan/Apply/Rollbackはbefore hash、idempotency、完全readbackを維持する。Plan作成用Receiptに加え、Apply専用Receiptをdry-runのplan ID・before/after hash・operations・差分へ束縛し、別承認なし・service principal・target変更・version不一致を構造化拒否する。

## リリース後検証

- [ ] PV-001: AC-001〜AC-005をPR Gateで検証してruntimeを本番反映した後、Aitle 1件の本番dry-runで、変更対象が`governs` Edge 1件だけ、既存baseline違反が増えないことを確認する。

PV-001は未デプロイのoperationでは実行できないためPR mergeの前提にはせず、未実行のまま成功扱いもしない。dry-run Receiptと差分を提示し、別のHuman Gate承認を受けるまでApplyしない。

## 非対象

- Decisionのproject scope移動
- Aitle ProductまたはDecision本文の複製
- 一般化された任意relationのcross-tenant write
- Human Gateなしの本番Apply
