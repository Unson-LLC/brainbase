# R1 不変履歴replay/evaluation Architecture

## 決定

R1はJ0の`JudgmentDAGRunRecord`とcontent-addressed artifactを履歴正本として利用し、新しい`judgment-dag-replay-evaluation` moduleをside-effect-freeな純粋境界として追加する。artifact storeの保存方式は変更しない。

```text
J0 artifact load
  -> historical record
  -> exact-version replay -> new run record -> J0 artifact save

baseline artifact + candidate artifact + outcome attachment
  -> detached immutable event set
  -> data-only criterion(goal, metric, scoring)
  -> overall comparison + node calibration
```

## 不変条件

1. Replayはhistorical recordの`dag`と`input`をsnapshotし、callerが指定した新しい`run_id`だけを差し替える。
2. Historical recordの`runner_versions`とregistrationのversionを実行前に照合する。registrationはown data propertyから一度だけcaptureし、照合と実行で同じsnapshotを使う。不足・不一致・accessorではrunner invocationは0件である。
3. 入力artifact IDはJ0の保存契約と同じcanonical content addressをrecordから再計算して照合する。Outcome attachmentは検証済み`artifact_id`、`run_id`、metric observationからcontent IDを計算し、run recordへfieldを追加しない。
4. Evaluation event setはbaseline/candidateのartifact ID、run record、outcome attachmentを束縛し、自身もcontent-addressedにする。baseline/candidate inputが違うeventを比較しない。
5. Evaluation criterionはcallbackを持たないdata-only contractとし、`pass_fail`または`numeric`だけを許可する。非有限number、重複metric、未知nodeを拒否する。
6. Overall scoreは全eventのrun observation、node calibrationはnode observationを評価する。欠測や片側だけのnodeを0へ丸めず状態として明示する。
7. Public APIはfilesystem、clock、randomness、network、Graphを呼ばない。artifactのload/saveはcallerがJ0 APIで明示的に行う。

## API境界

- `replayJudgmentDAGRun(request)`
- `createJudgmentDAGOutcomeAttachment(request)`
- `createJudgmentDAGEvaluationEventSet(request)`
- `evaluateJudgmentDAGVersions(request)`
- `JudgmentDAGReplayEvaluationError`

Replayだけが既存runnerを呼ぶ。Outcome attachment、event set、evaluationはpure calculationであり、入力artifactを更新しない。

## 失敗境界

安定codeは`invalid_request`、`runner_version_mismatch`、`artifact_mismatch`、`context_mismatch`、`outcome_mismatch`、`invalid_score`とする。raw runner failureは既存`JudgmentDAGExecutionError`を保持する。
