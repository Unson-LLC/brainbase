---
spec_id: r1-local-immutable-run-artifact-store
story_id: story-r1-local-immutable-run-artifact-store
status: needs_review
spec_maturity: draft
planning_status: needs_review
dependency_state: j0_merge_source_locked
implementation_ready: false
owner_model: single_local_owner
deployment_mode: local_non_hosted
sharing_boundary: none
multi_tenancy_applicability: not_applicable
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

### 所有者・配備境界（機械可読）

- owner_model: `single_local_owner`
- deployment_mode: `local_non_hosted`
- sharing_boundary: `none`
- multi_tenancy_applicability: `not_applicable`
- boundary_reason: caller-ownedな1つのlocal rootだけを対象とし、hosted entrypoint、cross-owner partition、shared resourceはこのdraftで定義しない。

## Artifact envelope

後続のschemaは、unknown fieldを拒否する二層の形式を固定する。ここでは意味契約だけを定義し、schema、fixture、source-lock、validatorは作成しない。

### Digest preimage payload

`payload`はartifact_idのdigest preimageであり、次のfieldだけを持つ。

| Field | Required meaning |
| --- | --- |
| artifact_schema_version | R1 artifact payloadのversion。未知versionはsave/reloadで拒否する |
| j0_source_lock | repository、PR、merge commit、implementation headのexact binding |
| run_id | J0 recordのnon-empty run identity。raw path segmentではない |
| record | J0 JudgmentDAGRunRecordの全immutable field。record.run_idはpayload.run_idと一致する |

`preimage_bytes = UTF-8(JCS(payload))`、`artifact_id = sha256:<lowercase hex SHA-256(preimage_bytes)>`とする。artifact_id自身、root path、filename、temporary name、mtime、permission、process id、環境値はpreimageへ含めない。

### Stored envelope

保存されるenvelopeは次のfieldだけを持ち、保存bytesは`UTF-8(JCS(envelope))`である。

| Field | Required meaning |
| --- | --- |
| artifact_id | payloadから再計算できるcontent address。payloadのdigest preimageには含めない |
| run_id | payload.run_idおよびpayload.record.run_idと完全一致する冗長なintegrity field |
| payload | 上記のdigest preimage payload |

したがって、`envelope.run_id === envelope.payload.run_id === envelope.payload.record.run_id`をschema、save、reloadの全段階で検証する。recordはJ0現行のrun_id、dag、input、execution_order、runner_versions、nodesを保持する。node recordのnode_id、runner_type、runner_version、input_contract、output_contract、input、dependency_outputs、outputを省略、並べ替え、推測補完しない。runner implementation、closure、clock、randomness、environment、filesystem handleは保存しない。

## Identity and digest

1. 入力recordをJ0 source-locked shapeとして検証し、payloadを組み立てる。
2. RFC 8785 JSON Canonicalization Scheme (JCS)でpayloadをcanonicalizeし、UTF-8 preimage bytesを得る。
3. preimage bytesのSHA-256を`sha256:` + 64桁lowercase hexadecimalへ束縛し、artifact_idを得る。
4. artifact_id、run_id、payloadからstored envelopeを組み立て、JCS(envelope)のUTF-8 bytesだけをartifact fileへ保存する。
5. reloadではpayloadからartifact_idを再計算し、stored artifact_idおよびcaller expected artifact_idと一致させる。その後envelope全体をJCS再シリアライズし、保存bytesとbyte-for-byte一致させる。
6. 同一payloadは同一artifact_idとなり、1 byteでも異なるpayloadは別identityとなる。artifact_idをpayloadへ戻して自己参照を作らない。

同じrun_id・同じartifact_id・同じstored envelope bytesだけはidempotent saveを許可する。同じrun_idで別artifact_id、別payload、別source lock、別schema version、または三層run_idの不一致を受けたsaveはrun_id conflict/integrity errorとして拒否し、既存bindingとartifactを変更しない。

## Canonical serialization

canonicalizationはRFC 8785 JSON Canonicalization Scheme (JCS)で固定し、独自の「辞書順JSON」を実装しない。JCSのproperty sorting（UTF-16 code unit順）、ECMAScript互換のnumber serialization、string escaping、UTF-8、whitespaceなしの規則を適用する。

- JSON-compatible plain valueだけを受理する。undefined、function、symbol、bigint、NaN、Infinity、cycle、非plain object、sparse array、lone surrogateはsave/reloadとも拒否する。
- envelope・payload・recordのrequired field、unknown field、wrong type、unknown artifact schema version、三層run_id不一致を拒否する。J0 recordがJCS入力として規格外ならsaveを拒否し、暗黙に補正しない。
- arrayはJ0 recordの意味上の順序を保持する。execution_order、runner_versions、nodes、dependency_outputsの並びは変更しない。
- 将来のfixtureは少なくとも次を固定する（出力はUTF-8 bytes）。`{"b":1,"a":2}` → `{"a":2,"b":1}`、`{"n":-0}` → `{"n":0}`、`{"n":1e-7}` → `{"n":1e-7}`、`{"s":"é"}` → 不要な非ASCII escapeなしのJCS bytes、lone surrogate (`"\\uD800"`) → reject。NaN/Infinityもrejectする。
- reloadではparse後にenvelopeをJCS再シリアライズし、元stored bytesとbyte-for-byte一致しない場合をintegrity failureとする。payloadのJCS bytesとstored envelope bytesを同じものとして扱わない。

## Save contract

入力の純粋なJCS検証・digest計算を済ませた後、saveは共有stateへ触れる最初の操作としてpayload.run_idのper-run exclusive reservation/lockを取得する。lock中の順序は次の通りである。

1. existing run_id bindingを確認する。同一artifact_id・同一stored envelope bytesならcompare-only idempotent候補、異なるなら`run_id conflict`としてtemporary file作成前にdenyする。
2. bindingがない場合、同一run_idのpublished-unbound crash artifactがrequested envelopeと完全一致するか確認する。一致すればbinding回復へ進み、不一致なら新artifactを公開せずdenyする。
3. 新規の場合だけ、stored envelope bytesを同一filesystem上のtemporary locationへ書く。temporaryはlist/reload/binding対象外である。
4. bytesをfsyncして同一filesystem内でatomic renameする。reservation、binding、artifact rootのdeviceが異なる場合はcross-filesystem atomic claimを行わずfail-closedにする。
5. rename後にbindingをcreate-onceで確定する。binding作成後、envelopeとbindingを再検証してcommitする。

saveの結果はnew、idempotent、または明示的なconflict/integrity errorのいずれかである。既存targetのoverwrite、unlinkしてからの差替え、競合時のlatest pointer更新、partial bytesの成功扱いを認めない。

### crash stateとcleanup境界

- `temporary`: lock中またはcrash後に残る未公開bytes。通常のlist/reload/bindingから不可視で、owner cleanupまたは将来の明示的maintenance storyだけがlock境界内でcleanupする。
- `published-unbound`: atomic rename後・binding前にcrashしたcanonical envelope。completed artifactではなく、通常のlist/reloadから不可視。次回同じrun_idのlock保持者がrequested envelopeと完全一致するときだけcreate-once bindingで回復し、異なる要求は新しいartifactを公開せずdenyする。save/reloadの暗黙cleanupや再利用は行わず、unbound file削除は将来maintenance storyだけが行う。
- `committed`: bindingがartifact_idを指し、stored envelope bytesとJCS再計算が一致する状態だけをcompleted artifactとして扱う。

## Reload contract

reloadはcallerが指定したartifact_idから安全なroot-relative locatorだけを導出する。locatorは固定digest形式以外を拒否し、root外、absolute path、separator、dot segment、NUL、URL scheme、symlink、non-regular fileをfollowしない。

読み戻しは次をすべて満たす場合だけ成功する。

- bytesが存在し、zero-byteでなく、完全なUTF-8 JSONである
- artifact schema versionとenvelope schemaがcurrentである
- stored artifact_id、payloadから再計算したartifact_id、caller expected artifact_idが一致する
- envelopeのJCS再シリアライズと元stored bytesがbyte-for-byte一致する
- J0 source lockがこのSpecのexact lockと一致する
- envelope.run_id、payload.run_id、payload.record.run_idが完全一致する
- run_id bindingがartifact_idを指し、recordの全required fieldが存在する。bindingなしpublished-unboundは拒否する
- parse objectがstorage bufferから分離され、返却envelopeとrecordがrecursive deep-frozenである

byte改変、追加field、field順差替え、digest差替え、三層run_id差替え、truncated JSON、zero-byte、partial write、unknown version、bindingなしartifactは成功値を返さない。自動repair、overwrite、削除、再公開をreloadの副作用にしない。

## Machine-readable result contract

save、reload、listは、後続実装で次のresult envelopeへ正規化する。これはplanning-onlyの契約であり、このSpecはruntimeやtestを作成しない。

成功結果はoperationごとにexact shapeを分け、余分なkeyを認めない。saveは`{ok, operation, status, artifact_id, run_id, record, binding}`で`record=null`、許可pairは`status=new`かつ`binding=created|recovered`、または`status=idempotent`かつ`binding=existing`の3通りだけである。reloadは同じ7 keyで`status=loaded`、`record`は検証済みでrecursive deep-frozenなJ0 record、`binding=verified`。listは`{ok, operation, status, items, count}`だけを返し、単一artifact keyをrootに持たない。list `empty`は`items=[]`・`count=0`、`committed`はcaller-owned root配下の全committed artifactを`{artifact_id, run_id, binding=verified}`として返し、`artifact_id`のUTF-8 bytewise lexicographic昇順で一意に並べ、`count=items.length`とする。temporaryとpublished-unboundは含めない。temporaryはlist=`empty`・reload=`not_found`、published-unboundはlist=`empty`・reload=`binding_missing_or_mismatch`であり、いずれもcleanupしない。

失敗結果もoperationごとにexact shapeを分ける。save/reloadは`{ok=false, operation, status=error, code, artifact_id, run_id, record=null, effects}`、listは`{ok=false, operation=list, status=error, code, items=null, count=null, effects}`だけを返す。全errorの`effects`は`success_record_returned=false`、`artifact_bytes_changed=false`、`binding_changed=false`、`repair_attempted=false`、`overwrite_attempted=false`、`delete_attempted=false`、`runner_invocations=0`を必須値とする。固定codeは`conflict`、`invalid_artifact_id`、`invalid_path`、`path_escape`、`schema_invalid`、`integrity_mismatch`、`binding_missing_or_mismatch`、`non_regular_file`、`cross_filesystem`、`not_found`であり、raw OS error文字列を契約値にしない。

VibePro `0.2.0-beta.11`の`pr prepare`読戻しはAC-002・AC-011の2/11だけをmapped、残り9/11をunmappedとする。Taskの11/11 coverageとdraftの13/13 `test_refs`はplanning contractであり、PR-ready evidenceではない。別のimplementation/verification changeでaccepted Specと実test/evidenceを結合し`pr prepare`を再生成するまで、draftのaccepted化、証拠なしのfinal Spec、Task coverageからのPR ready主張を禁止する。

## Fresh process/store negative E2Eとassertion units

後続テストはA/B fresh process protocolを使う。Aが同一rootへartifactまたはcrash fixtureをseedし、artifact・binding bytesを記録して終了する。fresh process/store Bが同じrootをreopenして一操作だけ行い、上記のexact result shape/code、save/reload errorの`record=null`、list errorの`items=null`・`count=null`、`runner_invocations=0`、修復・overwrite・deleteなしを確認する。Bの後にbytes、binding、committed identityを再読込し、既存状態が不変であることを確認する。

fixture/assertionは次を個別に持つ。

- tamper、truncated envelope、zero-byte envelopeのreloadはそれぞれ`integrity_mismatch`。
- bindingなしpublished-unboundのreloadは`binding_missing_or_mismatch`で成功値から不可視。完全一致の同一run recoveryはsave `new` + `binding=recovered`、異なるcanonical contentはsave `conflict`とし、どちらも暗黙cleanup・overwrite・deleteをしない。
- malformed artifact_idは`invalid_artifact_id`、unknown schema/extra fieldは`schema_invalid`、別artifactを指すbindingは`binding_missing_or_mismatch`、committed artifact不在は`not_found`とする。
- root escapeは`path_escape`。absolute path、NUL、slash separator、backslash separator、dot segment、URL schemeは各々`invalid_path`。
- reservation/binding/artifact rootのcross-filesystem claimは`cross_filesystem`で、atomic claimを試さない。
- symlink、directory、device、FIFO、socketは各々`non_regular_file`で、symlink followをしない。
- temporaryとpublished-unboundはlistで`empty`、reloadでsuccess recordなしとし、通常処理がcleanupしない。

committed list successは、`items`がcaller-owned root直下のcommitted artifactだけを含み、各itemが`artifact_id`・`run_id`・`binding=verified`だけを持ち、`count=items.length`、artifact_id UTF-8 bytewise lexicographic昇順であることを検証する。listのunsafe root/locator errorは`code=invalid_path`、`items=null`・`count=null`、effects全値zeroを検証する。

| Fixture/assertion unit | Operation | Expected result |
| --- | --- | --- |
| temporary file listed | list | `status=empty`、`items=[]`・`count=0`、cleanupなし |
| temporary file reloaded | reload | `not_found`、success recordなし、cleanupなし |
| published-unbound file listed | list | `status=empty`、`items=[]`・`count=0`、cleanupなし |
| published-unbound file reloaded | reload | `binding_missing_or_mismatch`、success recordなし、cleanupなし |

すべてのnegative assertionは、失敗resultのoperation別required keys、save/reloadでは`record=null`、listでは`items=null`・`count=null`、runner count 0、no repair/overwrite/delete、artifact/binding bytes unchangedを同時に検証する。

## Fail-closed matrix

| Category | Negative cases | Required result |
| --- | --- | --- |
| Identity | artifact_id形式不正、run_id欠落、source lock差替え、envelope/payload/record run_id不一致 | reject、filesystem effectなし |
| Serialization | RFC 8785 JCS key order/number/Unicode/lone-surrogate fixture違反、unknown field、非JSON値、cycle、sparse array、非有限数 | reject、artifactを公開しない |
| Save atomicity | reservation前の公開、write中断、zero-byte、rename前読取り、partial target、cross-filesystem claim | final artifactとして見せない |
| Idempotency | same run_id and same bytes | one immutable artifact、idempotent success |
| Run conflict | same run_id and different content/digest | conflict、existing binding/artifact unchanged |
| Immutability | overwrite、unlink+replace、digest mismatch、tamper | reject、既存artifactを変更しない |
| Reload | truncation、extra whitespace/field、wrong digest、三層run_id差替え、unknown schema、bindingless published-unbound | integrity/schema error、成功値なし |
| Filesystem | traversal、absolute path、NUL、dot segment、symlink、non-regular file | reject、root外read/writeなし |
| Concurrency | same content writers、different content same run_id writers、reservation race | same artifact or conflict、artifact公開前deny、last-write-winsなし |
| Snapshot | caller mutation、nested mutation、再reload後の差異 | deep-frozen equal snapshot、stored bytes不変 |

## Pre-fix RED sensitivity

後続のTDD REDは、実装前の既知の不安全挙動を少なくとも次のように固定する。

- envelope/payload/recordのrun_id不一致を保存できる。
- digest preimageとstored envelopeを混同し、artifact_idをpreimageへ自己参照できる。
- RFC 8785 JCSのobject key order、`-0`/指数number、Unicode、lone surrogate fixtureを誤って処理できる。
- run_id reservation前に競合内容のtemporary/final artifactを公開できる。
- 既存artifactを上書きできる。
- tamper、truncation、zero-byte、digest差替えをreloadできる。
- symlink、absolute path、path traversalでroot外へ到達できる。
- 同時writerの最後の内容がbindingを置き換える。
- temporary/partial/published-unbound fileをcompleted artifactとして読み込める、または曖昧な自動cleanupで削除・再利用できる。
- reloadしたnested objectの変更が次回reloadやidentityへ伝播する。

これらをpre-fix HEADでもpassするテストはRED証拠として不十分であり、既知の不具合を表す失敗を先に記録する。

## Planned verification（未作成）

J0 hard dependencyとこのdraftのreviewが成立した別changeで、synthetic run recordだけを用いて次を作成する。

- envelope schema、J0 source-lock、canonical digestのconformance
- RFC 8785 JCSのkey order、number、Unicode、lone surrogate fixtures、およびJCS非準拠J0 recordのsave拒否
- envelope/payload/record run_id完全一致と各層不一致のfail-closed
- same payload idempotencyとsame run_id different content conflict
- per-run reservation先行、atomic temporary publish、partial write、crash-after-writeのtemporary/published-unbound境界、concurrent writer
- tamper、truncation、zero-byte、unknown version、extra fieldのreload rejection
- traversal、symlink、non-regular file、root containmentのnegative matrix
- reload objectのrecursive deep-freezeとcaller/storage mutation isolation
- positive E2E: store/process Aでsynthetic J0 recordを同一rootへsaveして終了し、fresh process/store Bが同じrootをreopenして`artifact_id`をreloadする。元record完全一致、envelope・payload・record binding、J0 source lock・schema一致、deep-freeze、caller mutation後の再reload一致、J0 runner invocation count=0をassertする。

focused tests、full test、build、typecheck、package smoke、独立review、Gateはこのplanning sliceでは実行・完了扱いにしない。

## Path boundaryとVibePro設定

このplanning changeのallowed pathsは正確に次の6つである。

1. `docs/management/stories/active/story-r1-local-immutable-run-artifact-store.md`
2. `docs/architecture/story-r1-local-immutable-run-artifact-store.md`
3. `docs/specs/r1-local-immutable-run-artifact-store.md`
4. `docs/management/tasks/r1-local-immutable-run-artifact-store.json`
5. `.vibepro/spec/story-r1-local-immutable-run-artifact-store/draft.json`
6. `.vibepro/config.json`

`.vibepro/config.json`の既存story登録と`current_story_id`切替はこのplanning storyをVibeProの未指定操作の既定対象へするためだけの設定である。明示的な`--story-id`を指定した他storyのレビュー、artifact、判定には影響しない。source、schema、fixture、validator、test、runtime、package、DB/Graph/MCP/CLI/HTTP、customer data、secret、credential、deployment、他worktreeはforbiddenである。

## 明示的な非目標

- historical replay、historical contextの再実行
- runner versionの解決、registry、migration、互換性判定
- outcome attachment、evaluation event-set、evaluation mutation protection
- baseline/candidate version comparison、scoring、calibration
- execution log、hosted runtime、DB、Graph、MCP、CLI、HTTP、authorization
- schema、source-lock、fixture、validator、filesystem/runtime code、test code
- customer data、Personal本文、secret、credential、external send、deployment
- contract_ready、accepted、implemented、verified、production-ready、doneの宣言
