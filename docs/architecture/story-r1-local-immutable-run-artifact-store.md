---
architecture_id: story-r1-local-immutable-run-artifact-store
story_id: story-r1-local-immutable-run-artifact-store
status: proposed_needs_review
planning_status: needs_review
dependency_state: j0_merge_source_locked
related_milestone: docs/management/judgment-dag-milestones.md#M1--local-dag-kernel
j0_source_lock:
  repository: Unson-LLC/brainbase
  pull_request: 481
  merge_commit: f8e7ac61349b326863feae5d7d3d8ae68e2b9d10
  implementation_head: 3fd71a1da59a85cb7cdc8cce8b17f22e3b767bde
---

# R1 ローカル不変run artifact store Architecture

## 判断

J0の完了済みJudgmentDAGRunRecordを、J0 source lockとartifact schema versionを含むcanonical envelopeへ包み、envelopeのcontent digestをartifact identityとして扱う。保存先のファイル名、時刻、temporary name、環境値はidentityへ含めない。

artifactは一度公開したcanonical bytesを変更しない。同じrun_idの同じ内容だけを再保存可能にし、同じrun_idの異なる内容、既存digestの異なるbytes、検証不能なファイルはfail-closedで拒否する。reloadはexpected artifact identity、embedded digest、canonical serialization、J0 record shapeを再検証してからdeep-frozen snapshotを返す。

このArchitectureはcontract_preparationのplanning boundaryであり、filesystem実装や公開runtimeを追加しない。

## 依存gateとsource lock

R1はJ0 PR #481のexact系譜を入力契約とする。

| 項目 | 固定値 |
| --- | --- |
| repository | Unson-LLC/brainbase |
| PR | #481 |
| merge commit | f8e7ac61349b326863feae5d7d3d8ae68e2b9d10 |
| implementation head | 3fd71a1da59a85cb7cdc8cce8b17f22e3b767bde |
| input | JudgmentDAGRunRecord |

このlockはJ0の意味契約を参照するためのものであり、J0 Storyをdone、R1をimplemented、artifact storeをproduction-readyと宣言する根拠ではない。J0 sourceが変わった場合は、別のexact-head reviewでR1契約を再確認する。

## 契約境界

J0 JudgmentDAGRunRecord
  -> canonical artifact payload
     - artifact schema version
     - J0 source lock
     - run_id
     - immutable run record
  -> SHA-256 content address
     - immutable artifact bytes
     - create-once run_id binding
  -> verified reload
     - locator safety
     - bytes and digest
     - canonical re-serialization
     - J0 shape/source lock
     - deep-frozen snapshot

artifact payloadは、J0 recordの次の現行fieldを保存対象とする。

- run_id
- dag
- input
- execution_order
- runner_versions
- nodes
- nodeごとの node_id、runner_type、runner_version、input_contract、output_contract、input、dependency_outputs、output

runnerの実装、closure、時刻、乱数、環境値、filesystem handleはrecordへ入れない。runner versionを解決・取得するregistryもこのStoryへ持ち込まない。

## Artifact identityとbinding

artifact schema version、J0 source lock、run_id、recordを含むpayloadをcanonical bytesへ変換し、SHA-256をartifact_idとして固定する。digest計算対象へdigest自身を入れないため、自己参照や二重表現を作らない。

storeの論理状態は次の二つを持つ。

1. content-addressed artifact: artifact_idから一意に導出されるcanonical bytes
2. run_id binding: run_idが最初に受理したartifact_idをcreate-onceで指すbinding

bindingはlatest pointerではない。既存bindingと異なるartifact_idを受けた場合はrun_id conflictとして拒否し、既存artifactのoverwrite、削除、supersede、別digestの追加公開を行わない。bindingの具体的なindex形式は実装Storyで決めるが、同じatomic・no-overwrite・integrity境界に従う。

## Canonical serialization

- JSON-compatible plain valueだけを許可し、undefined、function、symbol、bigint、NaN、Infinity、-Infinity、cycle、非plain object、sparse arrayを拒否する。
- envelopeのunknown fieldと必須field欠落は拒否する。J0 recordもsource-locked shapeと型へ再検証する。
- object keyはrecursiveに辞書順で並べる。
- arrayはJ0の意味上の順序を保持する。execution_order、runner_versions、nodes、dependency_outputsをsortしてはならない。
- UTF-8、whitespaceなし、安定したJSON文字列表現をcanonical bytesとする。Unicode、number、escapeの規則はschemaで明記し、同じ意味でも別bytesになる実装を許可しない。
- digestはcanonical payload bytesのSHA-256であり、root path、filename、temporary file、mtime、permission、process idを含めない。

## Save state machine

unseen -> canonicalized -> digest_computed -> temp_written -> atomically_published -> binding_created -> committed

any pre-commit failure -> no readable final artifact
existing exact bytes   -> idempotent success
existing different bytes or binding -> conflict / integrity error

canonical bytesは同一filesystem上のtemporary locationへ書き、完成後にatomic publishする。final targetが先に存在する場合はcompare-onlyで扱い、既存bytesを上書きしない。異常終了でtemporary fileが残っても、それをartifactとして列挙・reload・bindingすることはない。

同時writerは、同じrun_idかつ同じcanonical digestなら同じimmutable artifactへ収束する。同じrun_idで内容が異なる場合はfirst create-once bindingを守り、後続writerはconflictとなる。last-write-wins、部分bytesの勝利、競合時の削除を認めない。

## Reloadとintegrity verification

reloadはcallerのartifact_idから固定されたrelative locatorだけを導出する。入力をpathとして連結せず、root外へ出る値やsymlinkをfollowしない。read後、次の順に検証する。

1. locatorがartifact_idの許可された形式と一致し、root内のregular fileである。
2. bytesが空でなく、完全なUTF-8 JSONとしてparseできる。
3. envelope schema、artifact schema version、J0 source lock、run_idを検証する。
4. embedded digest、callerのexpected artifact_id、canonical re-serializationのdigestが一致する。
5. canonical bytesと保存bytesがbyte-for-byte一致する。追加whitespaceやfield順変更も別artifactとして拒否する。
6. run_id bindingが同じartifact_idを指し、J0 recordの現行shapeが有効である。
7. parse objectをstorage bufferから分離し、envelopeとrecordを再帰的にdeep-freezeして返す。

tamper、truncation、zero-byte、JSON追加field、digest差替え、別run_id差替え、未知version、partial writeを成功値へ変換しない。失敗は識別可能なmachine-readable errorであり、修復のために既存artifactを自動変更しない。

## Filesystem安全境界

- artifact_idはsha256:に64桁のlowercase hexadecimalを続けた固定形式だけを受理し、slash、backslash、dot segment、NUL、absolute path、URL schemeを拒否する。
- run_idはraw path segmentにせず、bindingのlocatorへ安全に符号化する。符号化前後のroot containmentを検証する。
- root以下のlocatorにsymlink、非regular file、外部mountへの意図しない追従、parent traversalがある場合は拒否する。
- final targetはcreate-onlyまたはcompare-onlyで扱い、rename後のoverwriteを行わない。
- temporary artifactは完成artifactと別の明示的な状態であり、列挙・reload対象外とする。

## RED negative contract

後続実装のREDは、少なくとも次のpre-fix挙動を捕捉する。

| 負の挙動 | 拒否すべき理由 |
| --- | --- |
| 同じrun_idでpayloadを変えて保存できる | 履歴のidentityがlatest-writeで壊れる |
| object key順だけでdigestが変わる | canonical serializationがない |
| existing artifactをoverwriteできる | immutable artifactではない |
| tampered/truncated/zero-byte fileをreloadできる | integrity verificationがない |
| symlinkやpath traversalをfollowできる | root containmentがない |
| partial writeが完成artifactとして読める | atomic publishがない |
| concurrent writerがlast-write-winsになる | create-once bindingがない |
| reload objectのnested mutationが次回結果へ反映される | snapshot/deep-freezeがない |

## 後続へ委譲するもの

M3のhistorical replay、historical contextの再実行、DAG/runner version resolution、outcome attachment、evaluation event-set、baseline/candidate comparison、scoring、calibrationはこのArchitectureの外側である。artifactを保存できることは、replay可能、評価済み、version互換、production-readyであることを意味しない。

hosted database、Graph、MCP、CLI、HTTP、authorization、customer data、secret、deployment、retention/backup/recoveryも後続の別境界であり、本Storyでは扱わない。

## Path boundary

このplanning sliceのallowed pathsは次の5つだけである。

- docs/management/stories/active/story-r1-local-immutable-run-artifact-store.md
- docs/architecture/story-r1-local-immutable-run-artifact-store.md
- docs/specs/r1-local-immutable-run-artifact-store.md
- docs/management/tasks/r1-local-immutable-run-artifact-store.json
- .vibepro/spec/story-r1-local-immutable-run-artifact-store/draft.json

src、tests、contracts、package、database、migration、Graph、MCP、CLI、HTTP、customer data、secret、deployment、mana-runtime、他worktreeはforbiddenである。
