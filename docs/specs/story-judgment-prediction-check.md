# 予測の確認の契約（ADR-014）

`brainbase_judgment_frame_record` の予測のuse（`role: prediction`）は、任意の `check` を持てる。

- `check` は `falsified_if`（何が観測されたら予測が外れか。必須）、`status`（`held`・`failed`・`unchecked`。必須）、`evidence`（どこで確かめたか。`held` と `failed` では必須、800字まで）だけを持つ。
- 予測以外のuseへの `check`、未知の欄、空の条件、根拠のない `held`・`failed`、制御文字・秘密らしき値は、`frame_check_invalid` で記録を拒否する。
- 採用案が `failed` の予測に頼るとき、`chosen_relies_on_failed_prediction`（refs＝その世界モデル）を返す。他の枠組みのエスカレーションと同じく、hostが人間へ戻す。
- 記録の応答は `prediction_checks`（採用案の予測の `held`・`failed`・`unchecked` の件数。`check` の無い予測は `unchecked`）を返す。
- 記録の版は `judgment-frame-record.v1` のまま。`check` を使わない記録は従来どおりで、digestは入力全体から作る。

確かめた結果の意味的な正しさは判定しない。外れた予測を世界モデルへの反証として残すときは、`brainbase_judgment_model_outcome_record` を使う。
