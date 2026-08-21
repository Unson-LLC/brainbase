---
story_id: story-r1-local-immutable-run-artifact-store
title: R1 ローカル不変run artifact store契約
status: active
planning_status: needs_review
work_package_status: planned
execution_lane: contract_preparation
dependency_state: j0_merge_source_locked
implementation_ready: false
source:
  type: milestone
  id: M1-local-dag-kernel
related_milestone:
  id: M3-replay-and-evaluation
  role: later_consumer
j0_source_lock:
  repository: Unson-LLC/brainbase
  pull_request: 481
  merge_commit: f8e7ac61349b326863feae5d7d3d8ae68e2b9d10
  implementation_head: 3fd71a1da59a85cb7cdc8cce8b17f22e3b767bde
architecture_docs:
  - docs/architecture/story-r1-local-immutable-run-artifact-store.md
spec_docs:
  - docs/specs/r1-local-immutable-run-artifact-store.md
related_tasks:
  - docs/management/tasks/r1-local-immutable-run-artifact-store.json
---

# R1 ローカル不変run artifact store契約

## 利用者成果

Brainbase OSSの利用者として、J0が完了した同じJudgmentDAGRunRecordを、プロセス終了後も検証可能なcontent-addressed local artifactとして保存し、artifact identityを指定して同じ内容を安全に読み戻したい。これにより、後続のreplayとevaluationが、変更されたrun記録や壊れたファイルを履歴として扱わずに済む。

## このplanning sliceの目的

J0の現行JudgmentDAGRunRecordを入力とするR1 artifact envelope、canonical serialization、content digest、save/reload、immutability、filesystem failure semanticsをStory→Architecture→Spec→Taskへ固定する。このsliceはplanning-onlyであり、source、package、contract fixture、schema、test、filesystem実装、CLI/API、DB、MCP、deployは作らない。

## 依存状態とsource lock

J0の実装境界は、次の同一系譜へ固定する。

- repository: Unson-LLC/brainbase
- PR: #481
- merge commit: f8e7ac61349b326863feae5d7d3d8ae68e2b9d10
- implementation head: 3fd71a1da59a85cb7cdc8cce8b17f22e3b767bde
- input type: JudgmentDAGRunRecord

このsource lockはR1の契約を読むための基準であり、J0全体の完了、production readiness、runtimeの永続化実装を意味しない。別のJ0変更、runner version解決、replay、outcome/evaluationは本Storyの完了条件に含めない。

## 受け入れ基準

- [ ] AC-001: J0 source lockをmachine-readableに固定する

  J0 PR #481、merge commit、implementation headを上記のexact値で固定し、未確認のJ0 SHAや別branchの値を補わない。J0 program statusをこのStoryでdoneへ変更しない。

- [ ] AC-002: artifact identityをcontent addressとして固定する

  artifact envelopeはartifact schema version、J0 source lock、run_id、JudgmentDAGRunRecordを含む。artifact_idは、digest自身、filesystem path、temporary name、保存時刻、環境値を含めないcanonical payloadのSHA-256で一意に決まる。run_idだけをartifact identityにしない。

- [ ] AC-003: schemaとcanonical serializationをfail-closedにする

  envelopeとrun recordの許可field、required field、型、配列順を固定する。recursive object keyは辞書順、配列順はJ0 recordの意味順を保持し、UTF-8・compact JSONのcanonical bytesからdigestを計算する。undefined、関数、symbol、bigint、非有限数、循環値、非plain object、unknown field、truncated JSONは保存・読み戻しとも拒否する。

- [ ] AC-004: saveをatomicかつidempotentにする

  canonical bytesを一時ファイルへ書いてから同一filesystem内のatomic publishを行い、完成前のtargetをreadable artifactとして見せない。同じartifact_idと同じcanonical bytesの再保存は同じ結果を返すが、既存artifactを上書き、削除、差し替えしない。

- [ ] AC-005: 同じrun_idの異なる内容を拒否する

  storeはrun_idとartifact_idの最初のbindingをcreate-onceで固定する。同じrun_id・同じdigest・同じbytesだけをidempotentに受理し、同じrun_idでdigestまたはcanonical contentが異なるsaveはconflictとして拒否する。競合時に別artifactを追加してlatestへ差し替えたり、既存bindingを上書きしたりしない。

- [ ] AC-006: reload時にintegrityを再検証する

  artifact_idから導出した許可されたlocatorだけを読み、embedded digest、expected digest、canonical re-serialization、J0 source lock、record schemaを照合する。byte改変、JSONの追加field、digest改変、別run_idへの差し替え、zero-byte、途中書込み、truncation、未知schema versionは成功値を返さずrejectする。

- [ ] AC-007: reload結果をdeep-frozen snapshotにする

  reloadはstorage bufferやparse objectの参照を漏らさず、J0 recordとenvelopeを再帰的にsnapshotしてdeep-freezeする。callerが返却値、配列、nested objectを変更しても、保存済みartifact、次回reload、artifact identityは変わらない。

- [ ] AC-008: filesystem境界とwriter競合をfail-closedにする

  artifact_id、run_id、root-relative locatorに対するpath traversal、absolute path、NUL、separator、dot segment、symlink、non-regular file、root外書込みを拒否する。同一内容の同時writerは一つのimmutable artifactへ収束し、異なる内容の同一run_id同時writerは一方を勝者として他方をconflictにし、partial targetを完成扱いにしない。

- [ ] AC-009: RED negative evidenceを先に固定する

  実装後のTDDでは、既知のpre-fix挙動として、run_id変更で別内容が保存できる、canonical key順を変えるとdigestが変わる、既存targetをoverwriteできる、tamper/truncateをreloadできる、symlink/path traversalをfollowできる、同時writerがlast-write-winsになる、reload objectをmutationできる、をREDで検出してからGREENへ進める。

- [ ] AC-010: planning-only path境界を守る

  このchangeはStory、Architecture、draft Spec、Task、story-scoped VibePro draftの5ファイルだけを変更する。source-lock、schema、fixture、validator、src、test、package、filesystem、DB/MCP/CLI/HTTP、customer data、secret、deployへ触れない。

## 後続へ明示的に委譲する境界

- historical replayとrecordを別のDAG versionやcontextへ再実行する契約
- runner versionの解決、registry、実装互換性、version migration
- outcome attachment、evaluation event-set、evaluation mutation protection
- baselineとcandidateのversion comparison、scoring、calibration
- hosted runtime、DB、Graph、MCP、CLI、HTTP、権限、customer data、secret、deployment

本Storyはartifactの保存と検証可能な読み戻しの契約だけを扱う。M1のlocal artifact store基盤をM3のreplay/evaluation実装済みと推論しない。

## 完了状態

本Storyはplannedかつneeds_reviewのplanning recordであり、contract_ready、accepted、implemented、verified、production-ready、doneではない。実装へ進むには、このdraftをレビューし、別changeでsource-lock/schema/fixture/testとruntime境界を同一J0 sourceへ結び付ける必要がある。
