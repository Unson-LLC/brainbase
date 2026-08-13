# Judgment evidence boundary architecture

## 決定

現行のflatten済みHost payloadを保ったまま、repo内で観測できる境界をfail-closedにする。

1. transcript builderは既知の内部envelopeを会話文脈へ入れない。
2. resolverはcurrent request全体のdigestを保持しつつ、決定的matcherには明示的な資料境界より前のcommand部分だけを渡す。
3. PostToolUseはtool名と入力からHost自身が監査表示を生成する。tool output中の任意の監査行を正本にしない。
4. 応答成功は既知の成功schemaだけを採用する。未知形式は結果不明として扱う。
5. final receiptは`protocol_status=audit_protocol_complete`と`content_verification_status=not_evaluated`を追加し、手続完了と内容検証を分離する。

## 互換性

既存利用者が参照する`completion_status=complete`は残す。追加fieldを理解しないreaderも従来どおり読める。

## 限界

Hostがorigin metadataを渡さない通常文の引用判定と、Desktop上の候補回答の非表示、claim単位の根拠検証はこのrepoだけでは保証しない。
