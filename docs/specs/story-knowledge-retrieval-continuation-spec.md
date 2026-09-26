# 知識取得の継続契約

[Story](../user_stories/active/story-knowledge-retrieval-continuation.md)

- lookupの入力は元の質問、対象ヒント、必要項目、調査ID、世代番号、次の取得action。認可scopeをモデル入力から受け取らない。
- actionはsearch / read / follow_relation / finish。実取得は注入adapterのみを使い、任意URLやshellは実行しない。
- adapterは呼出しごとに認可を確認し、公開可能な投影本文だけを渡す。scope、結果の完全性、取得失敗を保持する。
- 結果はretrieved / empty / incomplete / transport_error / forbidden / ambiguous / unsupported。partialまたはunknownの空結果はemptyにせず、absence_confirmedは常にfalse。
- Host coreは質問とrequired_fieldsを固定し、lookup_id/revision/tool ID/action digestを照合する。不正なactionを実行しない。
- 初期予算は取得8回、再計画4回、120秒、同じ通信失敗の再試行2回。再試行も取得回数へ算入し、再開時に消費量を保持する。
- 同一指紋の再試行は直前のtransport_errorだけ許可する。他の取得はAIのinsufficient評価とwhy_differentを必要とする。
- satisfiedは必要な全項目がreadの出典・attemptに存在し、AIがsufficientと評価した場合だけ受理する。検索要約を本文証拠にしない。
- unfinished Stopは次の実取得へ戻すためのblockと文脈を返す。取消・上限・権限拒否・未対応は明示的に終了する。未確認を成功としない。
- coreの保存用状態に取得本文を含めない。Host側で状態の認証境界とロックを保証する。

## 対象検証

lookupの検索・本文・関係、失敗分類、公開フィールドと機密項目排除を検証する。coreは不足→再計画→本文→出典付き完了、入力不正、目的変更、検索要約での偽完了、通信再試行、重複Post、再開、取消を検証する。実Hostのモデル継続や稼働環境の有効化は、利用側の統合検証として別に記録する。
