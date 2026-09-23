# Company OS Receipt Adapter v1 Spec

## 契約

公開portは`company-os-receipt-adapter`から提供する。

- `ReceiptAdapterPort.link`: sourceを現在のportで検証し、同じSSOT transactionで不変のリンクを保存する。
- `ReceiptAdapterPort.read`: 保存recordを読み、source portで現在の認可と存在を再検証して投影する。
- `ReceiptAdapterPort.list`: 保存recordを全件読み、各sourceを現在のportで再検証して投影する。
- `ReceiptSourcePort.read`: source所有者が現在のread ACLを検証し、current referenceを返す。返却`null`はsource不在を表す。

`ReceiptSourceReference`の`kind`は`run_receipt`、`outcome_case`、`meeting_context_receipt`、`decision_event`のいずれか。`id`、任意の`revision`、記録されていない場合は`null`の`hash`、必須の`state`、typed/unknownを分けた`owner_refs`を持つ。adapterはhashを計算し直さず、`unknown`を空文字や成功へ置き換えない。

リンクは`judgment_refs`でProblem、Objective、Model、Constraint、DAG、Decision、Evaluation、evidenceの参照を保持できる。これは「その記録を判断に参照した」ことを表すだけであり、Objective達成や判断品質を導出しない。

## 受入条件

1. 四つのsource kindを同じportでリンク・読戻しできる。
2. 保存したsource kind・ID・revision・hash・state・owner refsと、judgment refsを同じ読戻しで取得できる。
3. 実行成功、OutcomeCaseのclosure、contextのresolved、decision eventの受信をObjective達成または判断品質へ自動変換しない。返却statusは`unrecorded`である。
4. link/read/listの各境界でsource providerの認可・存在・identityを検証する。provider不在、拒否、不一致、読戻し不能はfail closedし、未検証recordを返さない。
5. 同一link IDの同一内容は冪等に読戻し、別内容は`revision_conflict`にする。保存失敗でcanonical SSOTやsource正本を巻き戻さない。
6. OutcomeCasePortをsource portへ接続できる。closureやevaluationをOSS側へ再実装しない。

## 非目標

- source正本の作成・更新・closure・承認
- 旧Companion runtime・ledger・routeの復活
- raw payload、会議本文、顧客データ、secretの保存
- execution successからObjective achievementを推論すること

## 検証

unit/integration fixtureで四つのkind、ACL拒否、不在、identity mismatch、state変化、unknown owner/hash、冪等性、closure非推論を確認する。buildとpackage subpath importを実行する。外部sourceの実runtime接続、PR、CIはこのworktreeでは未確認であり、統合側で確認する。
