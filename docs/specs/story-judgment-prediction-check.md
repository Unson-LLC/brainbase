# 予測の確認の契約（ADR-014）

`brainbase_judgment_frame_record` の予測のuse（`role: prediction`）は、任意の `check` を持てる。

- `check` は `falsified_if`（何が観測されたら予測が外れか。必須）、`status`（`held`・`failed`・`unchecked`。必須）、`evidence`（どこで確かめたか。`held` と `failed` では必須、800字まで）、および任意の `balance`（反例チェリーピッキング・射程ミス防止のための構造欄）を持つ。
- `balance` は `claim_scope`（`universal`・`probabilistic`・`bounded_case`。必須）、`population`（母集団。文字列、2000字まで）、`supporting_summary`（支持根拠の要約。文字列、2000字まで）、`counter_summary`（反証探索・反例の要約。文字列、2000字まで）、任意の `counter_representativeness`（`census`・`representative`・`anecdotal`・`unknown`）、任意の `competing_hypotheses`（競合仮説の比較、最大8件）を持つ。
- 予測以外のuseへの `check`、未知の欄、空の条件、根拠のない `held`・`failed`、不正な `balance`、制御文字・秘密らしき値は、`frame_check_invalid` で記録を拒否する。
- 採用案が `failed` の予測に頼るとき、`chosen_relies_on_failed_prediction`（refs＝その世界モデル）を返す。他の枠組みのエスカレーションと同じく、hostが人間へ戻す。
- `balance` が指定された予測チェックでは、以下の追加エスカレーションを検査する（`balance` を省略した従来入力では発火しない）：
  - `prediction_unbalanced_evidence`：`held` で `population`・`supporting_summary`・`counter_summary` のいずれかが空/空白の場合、または `failed` で `population`・`counter_summary`（および `probabilistic` 時の `supporting_summary`）が空/空白の場合。
  - `prediction_scope_mismatch`：`claim_scope: probabilistic` の傾向的主張を `status: failed` とした際、`counter_representativeness` が `anecdotal` と明示されている場合、または未指定/`unknown` で母集団・コホート・複数件の定量検証が無く、保存済み結果が逸話反証のみか反証テキストが単発逸話のみを示す場合。`counter_representativeness` が `census` または `representative`、あるいは同一チェック内に母集団・コホート監査（例：`full cohort`、`N>=2`）が明記されている場合は発火しない。
- 記録の応答は `prediction_checks`（採用案の予測の `held`・`failed`・`unchecked` の件数。`check` の無い予測は `unchecked`）を返す。
- 記録の版は `judgment-frame-record.v1` のまま。`check` や `balance` を使わない記録は従来どおりで、digestは入力全体から作る。

確かめた結果の意味的な正しさは判定しない。外れた予測を世界モデルへの反証として残すときは、`brainbase_judgment_model_outcome_record` を使う。
