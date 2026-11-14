# 判断の結果を世界モデルへ書き戻す契約（ADR-014 F6）

`@unson/brainbase-mcp/judgment-frame` は、`brainbase_judgment_model_outcome_record` のtool定義とhandler、結果記録の検証・正規化・集計、一覧への反映を提供する。

## 記録

- 入力は `record_version`（`judgment-model-outcome.v1`）、現在の `catalog_digest`、`model`（`id`・`revision`）、`verdict`（`supports`・`refutes`・`inconclusive`）、`prediction`（判断時にこの世界モデルから立てた予測）、`observed`（観測した結果）、`conditions`（結果が成り立つ施設・期間・状態などの条件）、`evidence_refs`（1〜12件。`kind` は `artifact`・`query`・`document`・`judgment`）。
- `refutes` は `ruled_out` に `measurement_error`・`execution_difference`・`external_change` の三つ全てについて、その説明を退けた理由を必須とする。予測との差だけでは反証として記録しない。`refutes` 以外では `ruled_out` を受け付けない。
- 任意の `judgment_ref.frame_digest` で、予測を立てた判断の枠組みの記録を指せる。
- handlerは `loadRecords` で現在のカタログを作り直し、digest、参照が世界モデルであること、版が現在版と一致することを照合する。合格した記録だけを正規化し、内容のdigestを付けて `appendModelOutcome` に渡す。
- 古いカタログ、不明・世界モデル以外の参照、版の不一致、必須項目の欠落、証拠なし、秘密らしき値・制御文字、保存の失敗では成功しない。

## 一覧とエスカレーション

- `loadModelOutcomes` を渡したhostでは、カタログの世界モデル行に、**現在の版**に対する支持・反証・判定不能の件数と、直近の反証の条件（最大3件）を付ける。旧版への記録は件数に入れない。改訂後も反証が当てはまるかは、別の判断で確かめる。
- カタログのdigestは定義だけから作る。結果の件数は含めない。
- `brainbase_judgment_frame_record` は記録のたびに結果を読み直す。採用案が予測に使った世界モデルに現在版への反証があれば、`chosen_uses_refuted_model`（refs＝該当する世界モデル）を返す。
- 保存された結果記録の形が不正なら、一覧も記録も成功しない（黙って読み飛ばさない）。
- `loadModelOutcomes` を渡さないhostでは、一覧・digest・エスカレーションは従来と同じ。

## 対象外

支持・反証の判定が意味的に正しいかは判定しない。世界モデルの版、`validationState`、`adoptionState` は変えない。採否・改訂・検証済みへの格上げは人間が `foundation_adopt` や学習採用の経路で決める。保存先・記録者・認可・Stopでの扱いはhostの責務。
