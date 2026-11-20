# 知識取得の継続契約

[Story](../user_stories/active/story-knowledge-retrieval-continuation.md)

- lookupの入力は元の質問、対象ヒント、必要項目、調査ID、世代番号、次の取得action。認可scopeをモデル入力から受け取らない。
- actionはsearch / read / follow_relation / finish。実取得は注入adapterのみを使い、任意URLやshellは実行しない。
- adapterは呼出しごとに認可を確認し、公開可能な投影本文だけを渡す。scope、結果の完全性、取得失敗を保持する。
- 結果はretrieved / empty / incomplete / transport_error / forbidden / ambiguous / unsupported。partialまたはunknownの空結果はemptyにせず、absence_confirmedは常にfalse。finishは取得しない未検証の提案で、missing_fieldsは、reference_idsの中で根拠を挙げていない必須欄を示す。受理はHost coreが決める。
- Host coreは、初回の有効な取得計画で質問とrequired_fieldsを固定し（それまでの質問はHostが示す依頼文で、照合しない。初回のfinishは何も読んでいないので必ず拒否し、固定もしない）、lookup_id/revision/tool ID/action digestを照合する。不正なactionを実行しない。
- 初期予算は取得8回、再計画4回、最初の有効な取得予約から120秒、同じ通信失敗の再試行2回。再試行も取得回数へ算入し、再開時に消費量を保持する。未着手の有限終了と旧状態の互換は[初回取得予算Spec](story-knowledge-first-retrieval-budget-spec.md)に従う。
- 同一指紋の再試行は直前のtransport_errorだけ許可する。他の取得はAIのinsufficient評価とwhy_differentを必要とする。
- satisfiedは必要な全項目がreadの出典・attemptに存在し、AIがsufficientと評価した場合だけ受理する。検索要約を本文証拠にしない。attemptは、その呼出しのattempt_id（無ければtool ID）で識別する。結果が届かないままStopで中断した試行は、入力が残らないのでtool IDで記録する（transport_errorで、根拠にはならない）。
- unfinished Stopは次の実取得へ戻すためのblockと文脈を返す。取消・上限・権限拒否・未対応は明示的に終了する。未確認を成功としない。
- coreの保存用状態に取得本文を含めない。Host側で状態の認証境界とロックを保証する。

## 状態と操作

`status` は8つ。`resolving`・`retrieving`・`retry_pending`・`awaiting_replan` が途中、`satisfied`・`unresolved`・`needs_user_input`・`cancelled` が終わり。下の図は公開関数ごとに `status` が変わる遷移だけを書く（変わらない呼出し、たとえば拒否された計画や finish の予約は書かない）。

```text
createKnowledgeLookup:  (new) -> resolving
prepareKnowledgeAction: resolving/retry_pending/awaiting_replan -> retrieving                 (retrieval reserved)
prepareKnowledgeAction: resolving/retrieving/retry_pending/awaiting_replan -> unresolved      (invalid-plan limit, retrieval or replan budget, time budget)
recordKnowledgeResult:  retrieving -> retry_pending | awaiting_replan | unresolved            (transport_error | other outcome | forbidden, unsupported or time budget)
recordKnowledgeResult:  retry_pending -> awaiting_replan | unresolved                          (finish not accepted | finish unresolved or time budget)
recordKnowledgeResult:  awaiting_replan -> satisfied | unresolved | needs_user_input           (accepted finish, or time budget for unresolved)
stopKnowledgeLookup:    resolving/retrieving/retry_pending -> awaiting_replan                  (unfinished Stop; an in-flight reservation is kept as transport_error)
stopKnowledgeLookup:    retrieving/retry_pending/awaiting_replan -> unresolved                 (Stop limit or time budget)
cancelKnowledgeLookup:  resolving/retrieving/retry_pending/awaiting_replan -> cancelled
```

- 終わりの状態からはどの操作でも移らない。遅れて届いた結果、Stop、取消は終わりの状態をそのまま返す（取消済みをもう一度取り消しても同じ）。
- 途中の状態は、分岐の判断に使わない。判断は `pending`・`attempts`・`required_fields` と予算で決まり、`status` は Host とモデルへ見せる要約である。
- `tests/knowledge-continuation-transitions.test.ts` が、公開関数を有限の深さまで総当たりで呼んだときに起きる遷移の集合と、この図を展開した集合の一致を両方向で確かめる。

## 対象検証

lookupの検索・本文・関係、失敗分類、公開フィールドと機密項目排除を検証する。coreは不足→再計画→本文→出典付き完了、入力不正、目的変更、検索要約での偽完了、通信再試行、重複Post、再開、取消を検証する。実Hostのモデル継続や稼働環境の有効化は、利用側の統合検証として別に記録する。
