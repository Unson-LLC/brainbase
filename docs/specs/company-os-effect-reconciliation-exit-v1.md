# 外部作用照合による待機解除 v1

`markEffectUnknown` は、claim 済み wait と `external_operation_id` を必須にし、外部操作 ID と claim ID を照合待機記録に固定する。ホスト提供の `unknownEffect.verify` は元の実行意図にある wait ID・claim ID・run ID・外部操作 ID・unknown 状態を確認する。ホストは入力を単に反射せず、信頼できる実行意図と claim 対応を照会する。ポート不在・失敗・不一致でも `binding_status=unverified` として `reconciliation_wait` に隔離し、claim・handoff・resume を禁止する。`verified` の記録だけ自動照合で解除できる。書き込み権限や Problem 参照が失効した場合のホスト側停止は別途必要。

`reconcileExternalEffect` は記録済みの外部操作 ID と claim ID に一致する証拠だけをホスト提供の `externalEffect.verify` で照合する。ポートの結果は wait ID・claim ID・外部操作 ID・証拠参照と `performed` / `not_performed` / `unknown` を返し、いずれかが異なれば状態を変えない。ポートは元の操作についての権威ある証拠を照会し、入力本文の自己申告を結論に使わない。検証は SSOT mutation lock の外、書き込みは record・sidecar の CAS 内で行う。旧 ledger の binding が欠ける記録は読めるが、補完を推測せず `reconciliation_wait` に留める。

`performed` は `effect_confirmed` に移り、claim/resume/前提変更を禁止する。`not_performed` は古い claim を消して `waiting` に戻すが、再 claim は別の request ID を使い、外部実行には execution-authority の新しい許可を要する。`unknown` は `reconciliation_wait` を維持する。すべての結果は照合 receipt と履歴に追記し、同じ照合 request ID は入力が同じときだけ冪等に扱う。別の照合要求が結果と競合した場合は失敗する。

HTTP は既存の trusted context、tenant/scope、mutation-origin 検証を共用し、`effect-unknown` 本文には外部操作 ID を要求する。照合遷移には現在の書き込み ACL を要求する。外部作用の API・プロバイダの実装、結果の真偽保証、外部操作 ID の発行、再実行はこの変更の対象外。
