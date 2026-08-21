---
story_id: story-r1-local-immutable-run-artifact-store
title: R1 ローカル不変run artifact store契約
status: active
planning_status: needs_review
work_package_status: planned
execution_lane: contract_preparation
dependency_state: j0_merge_source_locked
implementation_ready: false
owner_model: single_local_owner
deployment_mode: local_non_hosted
sharing_boundary: none
multi_tenancy_applicability: not_applicable
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

J0の現行JudgmentDAGRunRecordを入力とするR1 artifact envelope、digest preimage payload、canonical serialization、content digest、save/reload、immutability、filesystem failure semanticsをStory→Architecture→Spec→Taskへ固定する。このsliceはplanning-onlyであり、source、package、contract fixture、schema、test、filesystem実装、CLI/API、DB、MCP、deployは作らない。VibeProの既存story登録を保持する`.vibepro/config.json`を含む正確な6ファイルだけを変更対象とする。

## 所有者・配備境界（機械可読）

- owner_model: `single_local_owner`
- deployment_mode: `local_non_hosted`
- sharing_boundary: `none`
- multi_tenancy_applicability: `not_applicable`
- boundary_reason: caller-ownedな1つのlocal rootだけを対象とし、hosted entrypoint、cross-owner partition、shared resourceはこのplanning sliceで定義しない。

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

  digest preimageとなる`payload`はartifact schema version、J0 source lock、run_id、JudgmentDAGRunRecordを含む。`artifact_id`は`sha256:<lowercase hex>` + `SHA-256(UTF-8(JCS(payload)))`であり、digest自身、filesystem path、temporary name、保存時刻、環境値をpreimageへ含めない。保存用envelopeは`artifact_id`、`run_id`、`payload`を含み、保存bytesはJCS(envelope)とする。artifact_idをpayloadへ戻さず、preimage bytesとstored envelope bytesを二層として扱う。

- [ ] AC-003: schemaとcanonical serializationをfail-closedにする

  RFC 8785 JSON Canonicalization Scheme (JCS)を固定し、envelope・payload・recordの許可field、required field、型、配列順を固定する。object keyはJCSの順序、配列順はJ0 recordの意味順を保持し、JCSのnumber/Unicode/string escaping規則に従う。`-0`、指数表記、Unicode文字、lone surrogate、key orderのfixturesを明示し、JCS非準拠のJ0 recordはsaveを拒否する。undefined、関数、symbol、bigint、非有限数、循環値、非plain object、unknown field、truncated JSONは保存・読み戻しとも拒否する。

- [ ] AC-004: saveをatomicかつidempotentにする

  入力のJCS検証・digest計算後、共有stateへ触れる最初の操作としてper-run exclusive reservation/lockを取得する。lock中にexisting bindingを確認し、異内容ならtemporary fileを作る前にdenyする。新規だけがtemporary envelope→同一filesystem内のatomic rename→create-once bindingの順に進む。完成前のtargetをreadable artifactとして見せず、cross-filesystem atomic claimはしない。同じartifact_idと同じcanonical envelopeの再保存は同じ結果を返すが、既存artifactを上書き、削除、差し替えしない。rename後・binding前のcrashはpublished-unboundとして不可視にし、暗黙cleanupせず、同じrun_idの完全一致回復または将来maintenance storyのlock内cleanupだけを許可する。

- [ ] AC-005: 同じrun_idの異なる内容を拒否する

  storeはrun_idとartifact_idの最初のbindingをcreate-onceで固定する。envelope.run_id、payload.run_id、record.run_idが完全一致し、同じrun_id・同じdigest・同じstored envelope bytesだけをidempotentに受理する。同じrun_idでdigest、canonical content、source lock、schema version、または三層run_idが異なるsaveはconflict/integrity errorとして拒否する。競合時に別artifactを公開してlatestへ差し替えたり、既存bindingを上書きしたりしない。

- [ ] AC-006: reload時にintegrityを再検証する

  artifact_idから導出した許可されたlocatorだけを読み、stored envelope bytesのJCS一致、payloadからのdigest再計算、embedded/expected digest、J0 source lock、record schemaを照合する。envelope.run_id、payload.run_id、record.run_idが完全一致しない場合を含め、byte改変、JSONの追加field、digest改変、別run_idへの差し替え、zero-byte、途中書込み、truncation、未知schema version、bindingなしartifactは成功値を返さずrejectする。

- [ ] AC-007: reload結果をdeep-frozen snapshotにする

  reloadはstorage bufferやparse objectの参照を漏らさず、J0 recordとenvelopeを再帰的にsnapshotしてdeep-freezeする。callerが返却値、配列、nested objectを変更しても、保存済みartifact、次回reload、artifact identityは変わらない。

- [ ] AC-008: filesystem境界とwriter競合をfail-closedにする

  artifact_id、run_id、root-relative locatorに対するpath traversal、absolute path、NUL、separator、dot segment、symlink、non-regular file、root外書込みを拒否する。同一内容の同時writerはper-run exclusive lockで一つのimmutable artifactへ収束し、異なる内容の同一run_id同時writerはartifact公開前に一方をdenyし、partial targetやpublished-unboundをcompleted扱いにしない。reservation・binding・artifact rootが別filesystemならatomic claimを試さず拒否する。

- [ ] AC-009: RED negative evidenceを先に固定する

  実装後のTDDでは、既知のpre-fix挙動として、envelope/payload/recordのrun_id不一致を保存できる、JCS fixture（key order、number、Unicode、lone surrogate）を誤って受理・変換する、run_id reservation前に競合artifactを公開する、既存targetをoverwriteできる、tamper/truncateをreloadできる、symlink/path traversalをfollowできる、同時writerがlast-write-winsになる、published-unbound/temporary fileをcompleted扱いする、reload objectをmutationできる、をREDで検出してからGREENへ進める。

- [ ] AC-010: planning-only path境界を守る

  このchangeはStory、Architecture、draft Spec、Task、story-scoped VibePro draft、既存story登録を維持する`.vibepro/config.json`の正確な6ファイルだけを変更する。`current_story_id`切替は未指定VibePro操作の既定対象をR1へ変えるだけで、明示的な`--story-id`を付けた他storyへ影響しない。後続のdisposable fixtureでは、R1がcurrentの状態で代表的なJ0の明示指定コマンドを実行し、選択storyと生成先がJ0だけであること、R1のreview/artifact bytesとGit状態が不変であることをreadbackする。source-lock、schema、fixture、validator、src、test、package、filesystem、DB/MCP/CLI/HTTP、customer data、secret、deployへ触れない。

- [ ] AC-011: fresh process/store restart・reopen roundtripをpositive E2Eとして固定する

  syntheticなJ0 recordを同一rootのstore/process Aでsaveし、Aを正常終了する。同じrootをfresh process/store Bでreopenし、`artifact_id`をreloadする。元recordとreload recordの完全一致、envelope・payload・recordのbinding、J0 source lock・schemaの一致を確認し、返却値がdeep-frozenであること、caller側のmutation後も次回reloadが元recordと一致することを確認する。reopen/reload中のJ0 runner呼出し回数は0である。このE2Eはplanned verificationであり、このplanning sliceではruntime・testを作成しない。

## Test contractとmachine-readable AC coverage

AC-001〜AC-011の機械可読なcoverageは、Taskの`acceptance_coverage`配列を正本とする。各entryは`ac_id`、`assertion_id`、future test path、pre-fix RED assertion、expected result、evidence artifact、release-block conditionを必須とし、11件すべてを1対1で保持する。Taskの`result_contract`はoperationごとにexact shapeを分ける。save成功の許可pairは`status=new`かつ`binding=created|recovered`、または`status=idempotent`かつ`binding=existing`の3通りだけであり、reload成功は単一artifactの`artifact_id`・`run_id`・`record`・`binding`を返す。list成功はそれらを返さず`items`・`count`だけを返す。artifact storeはseparatorを含まないartifact_id由来locatorを使うflat layoutであり、listはcaller-owned root直下だけを走査してdirectoryへ再帰せず、symlinkをfollowしない。`empty`は`items=[]`・`count=0`、`committed`はroot直下の検証済みbindingを持つ全committed itemを返す。committed itemは`artifact_id`のUTF-8 bytewise lexicographic昇順で一意に並べ、`count=items.length`とする。temporary、published-unbound、nested entryはlistへ含めない。temporaryはlistで`empty`、reloadで`not_found`、published-unboundはlistで`empty`、reloadで`binding_missing_or_mismatch`とし、それぞれbytes/bindingを保持してcleanupしない。save/reload失敗は`record=null`、list失敗は`items=null`・`count=null`とし、どちらも副作用をすべてゼロに固定する。`conflict`、`invalid_artifact_id`、`invalid_path`、`path_escape`、`schema_invalid`、`integrity_mismatch`、`binding_missing_or_mismatch`、`non_regular_file`、`cross_filesystem`、`not_found`を安定codeとして列挙する。

VibePro `0.2.0-beta.11`の`pr prepare`読戻しは現時点でAC-002とAC-011の2/11だけをmapped、残り9/11をunmappedと判定する。Taskの11/11 coverageとdraftの13/13 `test_refs`はplanning contractであり、PR-ready evidenceではない。別のimplementation/verification changeでaccepted Specと実test/evidenceを結合して`pr prepare`を再生成するまで、draftをaccepted扱いする、証拠なしでfinal Specを書く、Task coverageからPR readyを主張する、のいずれも禁止する。

後続の`tests/judgment-dag-artifact-store.test.ts`は、process/store Aがfixtureとartifact・binding bytesを記録して終了し、fresh process/store Bが同一rootをreopenして一操作だけ検証する。tamper、truncated、zero-byte、malformed artifact_id、unknown schema/extra field、binding mismatch、not found、published-unbound reload、同一内容のpublished-unbound recovery、異なる内容のconflict、root escape、absolute path、NUL、slash、backslash、dot、URL、cross-filesystem、symlink、directory、device、FIFO、socket、root直下committed listのitems/count/binding/root scope/order、nested directory内のvalid-looking committed/temporary/published-unboundを非再帰で除外するlist、listの`invalid_path` error、temporary list=`empty`、temporary reload=`not_found`、published-unbound list=`empty`、published-unbound reload=`binding_missing_or_mismatch`を各fixture/assertion unitとして持つ。別のdisposable VibePro fixtureでは、`current_story_id=R1`のまま明示的なJ0 story指定を行い、J0だけが選択・生成対象で、R1のreview/artifact bytesとGit状態が不変であることを専用証跡へreadbackする。save/reloadのnegative resultはexact code/shapeと`record=null`、listのerror resultは`items=null`・`count=null`を確認し、全errorでrunner invocation 0、repair/overwrite/deleteなし、artifact/binding bytes unchanged、cleanupなしを確認する。これはplanned-onlyであり、production/runtime/testの実証やJ0 runnerの実行をこのStoryで主張しない。

## 後続へ明示的に委譲する境界

- historical replayとrecordを別のDAG versionやcontextへ再実行する契約
- runner versionの解決、registry、実装互換性、version migration
- outcome attachment、evaluation event-set、evaluation mutation protection
- baselineとcandidateのversion comparison、scoring、calibration
- hosted runtime、DB、Graph、MCP、CLI、HTTP、権限、customer data、secret、deployment

本Storyはartifactの保存と検証可能な読み戻しの契約だけを扱う。M1のlocal artifact store基盤をM3のreplay/evaluation実装済みと推論しない。

## 完了状態

本Storyはplannedかつneeds_reviewのplanning recordであり、contract_ready、accepted、implemented、verified、production-ready、doneではない。実装へ進むには、このdraftをレビューし、別changeでsource-lock/schema/fixture/testとruntime境界を同一J0 sourceへ結び付ける必要がある。
