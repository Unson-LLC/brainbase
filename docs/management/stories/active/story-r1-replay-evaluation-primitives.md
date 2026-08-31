---
story_id: story-r1-replay-evaluation-primitives
title: R1 不変履歴のreplayとevaluation primitives
status: done
planning_status: accepted
work_package_status: done
execution_lane: closed
dependency_state: j0_done
implementation_ready: true
source:
  type: program_work_package
  id: R1
related_milestone:
  id: M3-replay-and-evaluation
  role: implementation
j0_source_lock:
  repository: Unson-LLC/brainbase
  implementation_head: 684f8c45c7c99d720c4acd7eca90dcda151c6196
  public_consumer_head: 9c0343c6b967cd34e1a45ed2d7c25d1c3f8ff3ae
  closure_merge: 18b6401c584e48ae6e7feed319836e74dc3d0910
architecture_docs:
  - docs/architecture/story-r1-replay-evaluation-primitives.md
spec_docs:
  - docs/specs/r1-replay-evaluation-primitives.md
related_tasks:
  - docs/management/tasks/r1-replay-evaluation-primitives.json
---

# R1 不変履歴のreplayとevaluation primitives

## 利用者成果

Brainbase OSSの利用者として、保存済みrunが記録したDAG・input・runner versionを使って過去判断を再実行し、同じ評価event setに対する新旧versionのscoreとnode差分を、過去artifactを書き換えずに比較したい。これにより判断品質を印象ではなく、明示したgoal・metric・scoring contractで検証できる。

## 受け入れ基準

- [x] AC-001: historical replayは保存済みrecordのDAGとinputだけをcontextとして使い、記録済みrunner versionと完全一致するregistrationだけで新しいrun_idへ再実行する。version不一致はrunner呼出し前にfail-closedとなる。
- [x] AC-002: outcomeはrun artifactと別のcontent-addressed attachmentとして作成し、run artifact ID・run_id・outcomeを不変snapshotで束縛する。元run recordやartifact bytesを変更しない。
- [x] AC-003: version comparisonは同じeventごとにbaseline/candidateのinputが完全一致する場合だけ実行し、両run artifactを読み取り専用で扱う。
- [x] AC-004: evaluationは非空のgoal、metric IDと、data-onlyな`pass_fail`または`numeric` scoring contractを必須とし、overall baseline/candidate/deltaを再現可能に返す。
- [x] AC-005: comparisonは共通nodeごとのbaseline/candidate/deltaとevent countを返し、nodeが片側だけにある場合は比較対象外として明示する。
- [x] AC-006: evaluation event setはcanonical contentからcontent IDを持ち、結果とともに再帰的にfreezeされた切断snapshotである。caller mutationはevent set、評価結果、content IDを変更しない。
- [x] AC-007: replay、outcome attachment、comparisonの関数と型をside-effect-freeな`@unson/brainbase-mcp/judgment-dag` subpathから利用できる。
- [x] AC-008: focused test、全unit、E2E、typecheck、build、packed-package consumer smoke、独立reviewが成功する。unknown/partial/skippedはpassに数えない。

## 責務境界

R1はhistorical replay、outcome attachment、明示的evaluation、DAG version comparison、node-level calibration、event-set immutabilityを所有する。J0が所有済みの単一artifact save/reload、integrity verification、fresh-process readbackは変更しない。

run_id index、cross-process lock、全fsync phaseのfault injection、RFC 8785移行、schema migration、maintenance cleanup、hosted persistenceはR1 Exit Gateに不要なため本Storyから外す。

## 非目標

- replay用runner binaryの自動取得、version migration、network registry
- outcome/evaluationのfilesystem・DB・Graph永続化
- evaluation scorerの業務意味を自動決定すること
- CLI、MCP、HTTP、UI、hosted runtime、権限、tenant、deploy、package publish

## 完了条件

AC-001〜AC-008の実証後にのみStoryとTaskをdoneへ更新する。R1 Program状態は、R1 Exit Gateの独立レビューと正本Roadmap更新が完了するまでdoneにしない。

## 2026-08-31 検証証跡

- focused: runner/artifact/R1の3 files / 41 tests pass
- full: 49 files / 478 tests pass、E2E 2 files / 2 tests pass
- `tsc --noEmit`、build、`git diff --check`: pass
- packed tarball consumer: install後のhistorical/candidate replay、outcome、event set、comparison 1/1 pass
- 独立boundary review: 初回P1 2件を修正後、delta reviewでblocking 0 / PASS
- 独立Exit Gate review: 3 Gateすべてpass、blocking 0、unknown/partial/skippedの成功扱いなし

公開版PR #493はrequired check `validate-and-publish` pass後にmergeされ、merge SHA `f73bfb41278bf8983c1d23dc8cb5be6c0e3379a1`を`upstream/develop`でreadbackした。Program正本PR #1342もrequired checks pass後にmergeされ、merge SHA `29f09bd47ba8e0a84e4a11d6e9950034ff2d7715`でR1を`done`へ昇格した。これによりStory、Task、Programの完了条件が揃った。
