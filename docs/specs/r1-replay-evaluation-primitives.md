---
spec_id: r1-replay-evaluation-primitives
story_id: story-r1-replay-evaluation-primitives
status: accepted
spec_maturity: implementation
dependency_state: j0_done
implementation_ready: true
architecture: docs/architecture/story-r1-replay-evaluation-primitives.md
canonical_story: docs/management/stories/active/story-r1-replay-evaluation-primitives.md
---

# R1 不変履歴replay/evaluation Specification

## Replay

`replayJudgmentDAGRun`はcontent-addressed artifact IDと対応するhistorical record、新しい`run_id`、runner registrationsを受け取る。artifact IDはJ0の保存契約と同じcanonical contentから再計算してrecordとの一致を検証する。新しいrun_idはhistorical run_idと異なる非空文字列でなければならない。必要なrunner type、version、run関数はaccessorを実行せずdata propertyから一度だけsnapshotし、historical recordの`runner_versions`と完全一致させる。照合した同一snapshotだけを`executeJudgmentDAG`へ渡す。実行requestのDAGとinputはhistorical recordの切断snapshotとする。

## Outcome attachment

`createJudgmentDAGOutcomeAttachment`は`attachment_version`、content-addressed `attachment_id`、`run_artifact_id`、`run_id`、metric observationsを返す。observationは`metric_id`、`scope: run|node`、任意の`node_id`、booleanまたは有限numberの`value`を持つ。metric/scope/nodeの重複、未知node、非有限numberを拒否する。返却値はdeep-frozenで元recordへoutcomeを書き込まない。

## Evaluation event set

`createJudgmentDAGEvaluationEventSet`が作る各eventは`event_id`と、baseline/candidateそれぞれの`artifact_id`、run record、outcome attachmentを持つ。event IDは一意、event setは非空とする。baseline/candidateのinputはcanonical JSONで一致し、各artifact IDはrecordのJ0 content addressと、各outcome attachmentのartifact ID/run_idは対応runと一致しなければならない。event setはcanonical contentから`event_set_id`を計算し、切断snapshotをdeep-freezeする。

## Criterionとscoring

`JudgmentDAGEvaluationCriterion`はcallbackを持たないdata-only contractである。非空`criterion_id`・`goal`・`metric_id`と、次のいずれかを持つ。

- `pass_fail`: `operator: eq|gte|lte`とbooleanまたは有限numberの`target`
- `numeric`: `direction: higher_is_better|lower_is_better`

評価はoutcome attachmentの一致するobservationだけを読み、pass/failは1または0、numericは観測numberそのものをscoreとする。欠測、型不一致、非有限numberを成功へ丸めない。

## Result

結果はdeep-frozenで、`event_set_id`、criterion、入力順の`event_ids`、run observationの平均`overall`、node ID昇順の`node_calibration`を含む。node状態は`comparable|baseline_only|candidate_only|no_observation`のいずれかで、欠測を0扱いしない。numeric directionは契約値として保持し、観測scoreを反転しない。

## 検証

- RED: API未実装、version mismatch、context mismatch、outcome mismatch、event mutation、non-finite scoreを検出する。
- GREEN: historical replay、別artifact outcome、同一eventでの新旧比較、node calibration、deep freezeを通す。
- Regression: J0 runner/artifact focused test、全unit、E2E、typecheck、build、packed consumerを通す。
