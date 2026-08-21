---
spec_id: r1-local-immutable-run-artifact-store
story_id: story-r1-local-immutable-run-artifact-store
status: needs_review
spec_maturity: draft
planning_status: needs_review
dependency_state: j0_merge_source_locked
implementation_ready: false
architecture: docs/architecture/story-r1-local-immutable-run-artifact-store.md
canonical_story: docs/management/stories/active/story-r1-local-immutable-run-artifact-store.md
j0_source_lock:
  repository: Unson-LLC/brainbase
  pull_request: 481
  merge_commit: f8e7ac61349b326863feae5d7d3d8ae68e2b9d10
  implementation_head: 3fd71a1da59a85cb7cdc8cce8b17f22e3b767bde
---

# R1 ローカル不変run artifact store Draft Specification

## 適用状態

このSpecはcontract_preparationのplanning-only draftであり、accepted Spec、実装仕様、production-ready判定ではない。J0 PR #481、merge commit f8e7ac61349b326863feae5d7d3d8ae68e2b9d10、implementation head 3fd71a1da59a85cb7cdc8cce8b17f22e3b767bdeのJudgmentDAGRunRecordだけを入力の正本として参照する。

## Artifact envelope

後続のschemaは、unknown fieldを拒否する次のenvelopeを固定する。ここでは意味契約だけを定義し、schema、fixture、source-lock、validatorは作成しない。

| Field | Required meaning |
| --- | --- |
| artifact_schema_version | R1 artifact envelopeのversion。未知versionはreloadで拒否する |
| artifact_id | canonical payload bytesのSHA-256 content address。digest自身は計算対象外 |
| j0_source_lock | repository、PR、merge commit、implementation headのexact binding |
| run_id | J0 recordのnon-empty run identity。raw path segmentではない |
| record | J0 JudgmentDAGRunRecordの全immutable field |

recordはJ0現行のrun_id、dag、input、execution_order、runner_versions、nodesを保持する。node recordのnode_id、runner_type、runner_version、input_contract、output_contract、input、dependency_outputs、outputを省略、並べ替え、推測補完しない。runner implementation、closure、clock、randomness、environment、filesystem handleは保存しない。

## Identity and digest

1. artifact_idの計算対象を、artifact_schema_version、j0_source_lock、run_id、recordからなるpayloadとする。
2. payloadをcanonical serializationしてUTF-8 bytesにする。
3. SHA-256のlowercase hexadecimal digestをartifact_idへ束縛する。artifact_idの許可形式はsha256:に64桁のlowercase hexadecimalを続けた固定形式とする。
4. artifact_id自身、root path、filename、temporary name、mtime、permission、process id、環境値はdigestへ含めない。
5. 同一payloadは同一artifact_idとなり、1 byteでも異なるpayloadは別identityとなる。
6. run_idは人為的なlatest keyではない。storeはrun_idとartifact_idの最初のbindingをcreate-onceで保持する。

同じrun_id・同じartifact_id・同じcanonical bytesだけはidempotent saveを許可する。同じrun_idで別artifact_id、別canonical bytes、別source lock、別schema versionを受けたsaveはrun_id conflictとして拒否し、既存bindingとartifactを変更しない。

## Canonical serialization

- JSON-compatible plain valueだけを受理する。
- undefined、function、symbol、bigint、NaN、Infinity、-Infinity、cycle、非plain object、sparse arrayは保存前にもreload後にも受理しない。
- envelopeのrequired field欠落、unknown field、wrong type、unknown artifact schema versionは拒否する。
- object keyは全階層で辞書順に正規化する。
- arrayはJ0 recordの意味上の順序を保持する。execution_order、runner_versions、nodes、dependency_outputsの並びは変更しない。
- UTF-8、whitespaceなしの一意なJSON bytesを生成する。Unicode escaping、number表現、string escapingの仕様を固定し、同じ意味を複数bytesで表さない。
- reloadではparse後に再canonicalizeし、元bytesとbyte-for-byte一致しない場合をintegrity failureとする。単なるJSON parse成功を保存成功の証拠にしない。

## Save contract

saveは次の順序を満たす。

1. 入力recordをJ0 source-locked shapeとしてsnapshotする。
2. envelopeをcanonicalizeし、content digestを計算する。
3. final targetとrun_id bindingが存在しない場合だけ、temporary locationへbytesを書き、同一filesystem内でatomic publishする。
4. publish後にbindingをcreate-onceで確定する。
5. 既存targetまたはbindingがある場合はcompare-onlyでcanonical bytesとdigestを照合する。

saveの結果は、new、idempotent、または明示的なconflict/integrity errorのいずれかである。既存targetのoverwrite、unlinkしてからの差替え、競合時のlatest pointer更新、partial bytesの成功扱いを認めない。temporary fileは未完了artifactであり、reloadやbindingの対象外とする。

## Reload contract

reloadはcallerが指定したartifact_idから安全なroot-relative locatorだけを導出する。locatorは固定digest形式以外を拒否し、root外、absolute path、separator、dot segment、NUL、URL scheme、symlink、non-regular fileをfollowしない。

読み戻しは次をすべて満たす場合だけ成功する。

- bytesが存在し、zero-byteでなく、完全なUTF-8 JSONである
- artifact schema versionとenvelope schemaがcurrentである
- stored artifact_id、embedded digest、caller expected artifact_idが一致する
- canonical re-serializationのSHA-256と元bytesが一致する
- J0 source lockがこのSpecのexact lockと一致する
- run_id bindingがartifact_idを指し、recordの全required fieldが存在する
- parse objectがstorage bufferから分離され、返却envelopeとrecordがrecursive deep-frozenである

byte改変、追加field、field順差替え、digest差替え、別run_id差替え、truncated JSON、zero-byte、partial write、unknown versionは成功値を返さない。自動repair、overwrite、削除、再公開をreloadの副作用にしない。

## Fail-closed matrix

| Category | Negative cases | Required result |
| --- | --- | --- |
| Identity | artifact_id形式不正、run_id欠落、source lock差替え | reject、filesystem effectなし |
| Serialization | key順依存、unknown field、非JSON値、cycle、sparse array、非有限数 | reject、artifactを公開しない |
| Save atomicity | write中断、zero-byte、rename前読取り、partial target | final artifactとして見せない |
| Idempotency | same run_id and same bytes | one immutable artifact、idempotent success |
| Run conflict | same run_id and different content/digest | conflict、existing binding/artifact unchanged |
| Immutability | overwrite、unlink+replace、digest mismatch、tamper | reject、既存artifactを変更しない |
| Reload | truncation、extra whitespace/field、wrong digest、unknown schema | integrity/schema error、成功値なし |
| Filesystem | traversal、absolute path、NUL、dot segment、symlink、non-regular file | reject、root外read/writeなし |
| Concurrency | same content writers、different content same run_id writers | same artifact or conflict、last-write-winsなし |
| Snapshot | caller mutation、nested mutation、再reload後の差異 | deep-frozen equal snapshot、stored bytes不変 |

## Pre-fix RED sensitivity

後続のTDD REDは、実装前の既知の不安全挙動を少なくとも次のように固定する。

- run_idだけをkeyにして異なるrecordを保存できる。
- object keyを並べ替えただけで同じ内容のdigestが変わる。
- 既存artifactを上書きできる。
- tamper、truncation、zero-byte、digest差替えをreloadできる。
- symlink、absolute path、path traversalでroot外へ到達できる。
- 同時writerの最後の内容がbindingを置き換える。
- temporary/partial fileをcompleted artifactとして読み込める。
- reloadしたnested objectの変更が次回reloadやidentityへ伝播する。

これらをpre-fix HEADでもpassするテストはRED証拠として不十分であり、既知の不具合を表す失敗を先に記録する。

## Planned verification（未作成）

J0 hard dependencyとこのdraftのreviewが成立した別changeで、synthetic run recordだけを用いて次を作成する。

- envelope schema、J0 source-lock、canonical digestのconformance
- same payload idempotencyとsame run_id different content conflict
- atomic temporary publish、partial write、crash-after-write、concurrent writer
- tamper、truncation、zero-byte、unknown version、extra fieldのreload rejection
- traversal、symlink、non-regular file、root containmentのnegative matrix
- reload objectのrecursive deep-freezeとcaller/storage mutation isolation

focused tests、full test、build、typecheck、package smoke、独立review、Gateはこのplanning sliceでは実行・完了扱いにしない。

## 明示的な非目標

- historical replay、historical contextの再実行
- runner versionの解決、registry、migration、互換性判定
- outcome attachment、evaluation event-set、evaluation mutation protection
- baseline/candidate version comparison、scoring、calibration
- execution log、hosted runtime、DB、Graph、MCP、CLI、HTTP、authorization
- schema、source-lock、fixture、validator、filesystem/runtime code、test code
- customer data、Personal本文、secret、credential、external send、deployment
- contract_ready、accepted、implemented、verified、production-ready、doneの宣言
