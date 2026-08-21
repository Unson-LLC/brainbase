---
title: J0 Local Deterministic Runner Architecture
status: accepted
date: 2026-08-21
story_id: story-j0-local-deterministic-runner
governed_by: docs/architecture/judgment-dag-core.md
---

# J0 ローカル決定論的ランナー設計

## 決定

既存の`validateJudgmentDAG`を唯一の構造preflightとして再利用し、そのexecution orderを直列に消費するside-effect-freeなruntime moduleを追加する。runtimeは永続化や権限解決を所有せず、明示的なrun requestとrunner登録から不変なrun記録を返す。

```text
JudgmentDAGRunRequest
  ├─ run_id
  ├─ dag
  ├─ input (JSON value)
  └─ runners[runner_type] = { version, run }
          ↓ preflight: DAG + required runner registrations
validateJudgmentDAG.execution_order
          ↓ sequential node execution
frozen runner input
  ├─ run / DAG identity
  ├─ node contract
  ├─ immutable run input
  └─ direct dependency outputs only
          ↓ JSON snapshot at every boundary
deep-frozen JudgmentDAGRunRecord
```

## 公開面

- 実装は`src/judgment-dag-runner.ts`へ分離する。
- `src/judgment-dag.ts`は既存contract exportを維持したままrunner型と実行関数を再exportする。
- packageの`./judgment-dag` subpathと`./dist/*`互換は変更しない。
- package root、MCP server、CLIはrunnerを自動起動しない。

## 実行契約

1. `validateJudgmentDAG`でcallerのDAG構造と順序を先に確定する。validatorが返すmachine-readable error code/detailsはJSON snapshot errorへ置換しない。
2. 検証済みのrequest DAGとinputをJSON-compatible snapshotへ複製する。関数を含むrunner登録はsnapshot対象外とする。
3. execution order上の全nodeについて、該当`runner_type`の登録・非空version・callable `run`を先に確認する。欠落があれば実行を一度も開始しない。
4. nodeごとに、直接依存nodeの確定済みoutputだけをID順のreadonly list（`{ node_id, output }[]`）へ詰め、deep-frozen runner inputを作る。IDをobject keyとして扱わず、`__proto__`等の有効IDでもprototype pollutionを起こさない。
5. runner outputをJSON-compatible snapshotへ複製する。`undefined`、関数、symbol、bigint、非有限数、循環参照、非plain objectは拒否する。
6. 実行開始前にcaller指定`run_id`をlocal snapshotとして捕捉し、その値、DAG ID/version、DAG/input snapshot、execution order、runner version、node contract refs、outputを一つのdeep-frozen run recordとして返す。runnerがcaller requestを変更してもnode間・最終recordのrun_idは変わらない。

runnerは同期値またはPromiseを返せるが、runtimeはnodeを直列にawaitする。並列化は同値性と副作用境界が別途固定されるまで行わない。

## エラー契約

- 既存DAG validation errorはそのまま保持する。
- runner登録欠落、不正request、不正JSON境界、runner失敗は`JudgmentDAGExecutionError`のmachine-readable codeで区別する。runner失敗は`failure_kind`で同期throwと非同期rejectを区別する。
- preflight failureではrunner call countが0でなければならない。
- runner failure後の再試行、partial record永続化、補償処理はこのStoryでは扱わず、元errorをcauseとして保持してfail loudする。失敗時に成功run recordを返さない。

## 不変性と決定性

- caller inputを変更しない。
- `run_id`は最初のrunner callより前にlocal snapshotし、caller requestやrunner closureの後続mutationから分離する。
- runnerへ渡す値と返却run記録をdeep-freezeする。
- object key順に意味を持たせず、dependency IDとexecution orderは既存validatorの安定順序を使う。
- 時刻、乱数、環境変数、filesystem、networkをruntime自身は読まない。
- 決定性は同じ明示入力とrunner実装に対するruntimeの性質であり、任意runnerの外部副作用やclosure内部状態までは保証しない。

## 後続境界

- R1: run recordの永続store、reload、historical replay、version comparison、outcome/evaluation contract。
- G0: authority-bound runner、human pending、approval、retry、locking、idempotency、external side effect。
- C0: organization consumerでのexact package version conformance。

この分離により、J0 runtimeがR1の履歴評価やG0の会社権限を先取りしない。
