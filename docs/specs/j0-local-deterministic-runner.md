---
title: J0 ローカル決定論的ランナー仕様
status: accepted
story_id: story-j0-local-deterministic-runner
architecture: docs/architecture/story-j0-local-deterministic-runner.md
date: 2026-08-21
---

# J0 ローカル決定論的ランナー仕様

## 公開契約

`./judgment-dag`は既存のDAG型・validatorに加えて、readonlyなrun request、runner登録、runner input、node実行記録、run記録、`executeJudgmentDAG`、machine-readableな実行errorを公開する。package root、CLI、MCPは実行を自動開始しない。

## 受け入れシナリオ

### AC-001 公開型

利用者が`./judgment-dag`からrunner契約と実行関数をimportできる。既存exportを削除・改名しない。

### AC-002 実行前preflight

runtimeはDAGを`validateJudgmentDAG`で検証し、execution orderに現れる全runner typeの登録、非空version、callable `run`を確認してから最初のrunnerを呼ぶ。一件でも欠落・不正があればcall count 0のまま、安定したerror codeで拒否する。

### AC-003 安定順序と直接依存だけの入力

各nodeはvalidatorのexecution orderで一度だけ直列実行される。runner inputの`dependency_outputs`は、そのnodeが宣言した直接依存をnode ID順に並べた`{ node_id, output }[]`であり、推移的依存や非依存nodeを含めない。IDをobject keyに使わないため、`__proto__`等の有効IDでprototype pollutionを起こさない。

### AC-004 JSON境界とmutation防止

DAG、run input、runner input、runner output、run recordはJSON-compatible snapshotとしてcaller/runnerの参照から分離する。`undefined`、関数、symbol、bigint、非有限数、循環参照、非plain objectをfail-closedで拒否する。後続mutationで確定済み記録は変わらない。

### AC-005 不変で決定的なrun記録

成功記録はcaller指定`run_id`、DAG ID/versionとsnapshot、run input、execution order、各nodeのrunner version、input/output contract参照、outputを含み、再帰的にfreezeされる。runtime自身は時刻、乱数、環境変数、filesystem、networkを読まず、同じ明示入力とrunner実装から同値の記録を返す。

### AC-006 回帰境界

既存J0 schema、fixture、digest、source-lock、`./dist/*` deep import、package root、CLI、MCPを変更しない。対象test、既存J0回帰、公開consumer、full test、build、typecheck、差分検査を同一HEADで成功させる。

## エラー

`JudgmentDAGExecutionError`は少なくとも不正request、runner登録不備、不正JSON snapshot、runner失敗を区別する。DAG validatorのmachine-readableな失敗は改変しない。runner失敗は元errorを`cause`として保持し、partial recordを成功値として返さない。

## 非目標

永続store、historical replay、評価・version比較、権限解決、人やagentの待機、承認、再試行、補償、外部副作用、MCP/CLI command追加、DB、migration、secret、tenant/customer mutation、deploymentはこの仕様に含めない。
