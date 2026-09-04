# Story: Brainbase監査行を最終回答へ確実に表示する

## 利用者価値

Brainbaseを使ったturnの直後に、利用者が最終回答だけを見て判断経路と実参照の有無を確認できる。

## 現象

Hostは監査行をjournalへ保存し、Stopの`systemMessage`へ返していたが、Codex Desktopの実際の最終回答には表示されなかった。それでも`owner_audit_complete=true`を記録していた。

## 受入条件

- AC-001: 最終assistant回答の先頭に、Hostが確定した`🧠`と`📚`/`⚠️`監査行がjournal順で各1回だけ表示される。
- AC-002: 監査行が無い、順序が違う、または未記録の`🔁`/`🛠️`行がある最初のStopは、正確な監査ブロックを示して差し戻す。
- AC-003: 監査だけを直す再回答でも、元の業務本文が削除・要約・置換されない。
- AC-004: `PostToolUse`はeventと状態を記録するだけでfinalを確定せず、成功receiptは`owner_audit_source=assistant_answer`を記録する。
- AC-005: 同じepisodeで二度目も監査契約を満たさない場合は`audit_degraded`へ有限収束し、`owner_audit_complete=true`へ偽装しない。
- AC-006: deploy後の新規taskで、実際の最終回答とfinal receiptを照合できるまで本番表示を合格にしない。

## 対象外

- Codex Desktop自体のHook `systemMessage`描画仕様の変更。
- 過去turnのfinal receiptの書き換え。
