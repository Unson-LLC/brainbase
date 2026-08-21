---
architecture_id: story-r1-local-immutable-run-artifact-store
story_id: story-r1-local-immutable-run-artifact-store
status: proposed_needs_review
planning_status: needs_review
dependency_state: j0_merge_source_locked
owner_model: single_local_owner
deployment_mode: local_non_hosted
sharing_boundary: none
multi_tenancy_applicability: not_applicable
related_milestone: docs/management/judgment-dag-milestones.md#M1--local-dag-kernel
j0_source_lock:
  repository: Unson-LLC/brainbase
  pull_request: 481
  merge_commit: f8e7ac61349b326863feae5d7d3d8ae68e2b9d10
  implementation_head: 3fd71a1da59a85cb7cdc8cce8b17f22e3b767bde
---

# R1 ローカル不変run artifact store Architecture

## 判断

J0の完了済みJudgmentDAGRunRecordを、JCSで正規化した二層のartifactへ固定する。第一層はartifact_idのdigest preimageである`payload`、第二層は`artifact_id`と`run_id`を含む保存用`envelope`である。`artifact_id`は`sha256:<hex>` + `SHA-256(JCS(payload)のUTF-8 bytes)`であり、payloadにartifact_id自身を入れない。保存されるbytesはJCS(envelope)であり、preimage bytesとは別物である。

artifactは一度公開した保存用envelope bytesを変更しない。同じrun_idの同じ内容だけを再保存可能にし、envelope・payload・recordの3つのrun_idが一致しない入力、同じrun_idの異なる内容、既存digestの異なるbytes、検証不能なファイルはfail-closedで拒否する。reloadはexpected artifact identity、stored envelope bytes、payloadからのdigest再計算、J0 record shapeを再検証してからdeep-frozen snapshotを返す。

このArchitectureはcontract_preparationのplanning boundaryであり、filesystem実装や公開runtimeを追加しない。

## 所有者・配備境界（機械可読）

- owner_model: `single_local_owner`
- deployment_mode: `local_non_hosted`
- sharing_boundary: `none`
- multi_tenancy_applicability: `not_applicable`
- boundary_reason: caller-ownedな1つのlocal rootだけを対象とし、hosted entrypoint、cross-owner partition、shared resourceはこのArchitectureで定義しない。

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
  -> payload (digest preimage; JCS canonical bytes)
     - artifact schema version
     - J0 source lock
     - run_id
     - immutable run record (record.run_id is identical)
  -> artifact_id = sha256:SHA-256(JCS(payload) UTF-8 bytes)
  -> stored envelope (JCS canonical bytes)
     - artifact_id (not in preimage)
     - run_id (must equal payload.run_id and record.run_id)
     - payload
  -> verified reload
     - locator and binding safety
     - stored envelope bytes and envelope digest
     - payload digest preimage recomputation
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

digest preimageと保存用envelopeを混同しない。

1. `payload`は`artifact_schema_version`、exact `j0_source_lock`、`run_id`、`record`だけを含む許可されたobjectである。`payload.run_id`と`payload.record.run_id`は常に完全一致する。
2. `preimage_bytes = UTF-8(JCS(payload))`とし、`artifact_id = sha256:<lowercase hex SHA-256(preimage_bytes)>`とする。artifact_id、保存path、filename、temporary name、mtime、permission、process id、環境値はpreimageに含めない。
3. 保存するenvelopeは、許可された`artifact_id`、`run_id`、`payload`だけを含む。`envelope.run_id === envelope.payload.run_id === envelope.payload.record.run_id`をschema、save、reloadの全段階で検証する。
4. `stored_bytes = UTF-8(JCS(envelope))`をartifact fileへ保存する。reload時にはenvelopeからpayloadを取り出してartifact_idを再計算し、stored envelopeのcanonical bytesが`stored_bytes`とbyte-for-byte一致することも検証する。artifact_id自身をpreimageへ戻すことはない。

storeの論理状態は次の二つを持つ。

1. content-addressed artifact: artifact_idから一意に導出されるcanonical bytes
2. run_id binding: run_idが最初に受理したartifact_idをcreate-onceで指すbinding

bindingはlatest pointerではない。既存bindingと異なるartifact_idを受けた場合はrun_id conflictとして拒否し、既存artifactのoverwrite、削除、supersede、別digestの追加公開を行わない。bindingの具体的なindex形式は実装Storyで決めるが、同じatomic・no-overwrite・integrity境界に従う。

### run_id reservationの順序

saveは入力の純粋なJCS検証・digest計算を終えた後、共有stateへ触れる最初の操作として、payload.run_idに対応するper-run exclusive reservation/lockを取得する。lock保持中の順序は固定する。

1. existing run_id bindingを読み、同一artifact_id・同一envelopeならcompare-onlyのidempotent候補、異なる場合は`run_id conflict`として即時denyする。
2. bindingがなく、同一run_idのcrash recovery対象（後述のpublished-unbound）がある場合は、requested envelopeと完全一致する時だけbinding作成へ進み、異なる時はartifact公開前にdenyする。
3. 新規の場合だけtemporary envelopeを作成し、JCS(envelope) bytesを書き、同一filesystem内でatomic renameする。
4. rename後にcreate-once bindingを確定する。binding作成が競合した場合はwinnerを検証し、loserの新規binding・overwrite・削除を行わない。

reservation、binding、artifact rootは同じfilesystemであることを実装時に確認する。cross-filesystemのatomic claimやrenameを契約に含めず、deviceが異なる場合はsaveを開始せずfail-closedにする。

## Positive E2E: process restart・reopen roundtrip

後続の実装changeは、syntheticなJ0 `JudgmentDAGRunRecord`を使い、同一rootを跨ぐprocess restart/reopenをpositive E2Eとして検証する。store/process Aがrecordをsaveして正常終了した後、fresh process/store Bが同じrootをreopenし、`artifact_id`からreloadする。E2Eの必須assertionは次の通りである。

1. reload recordがAでsaveした元recordと完全一致し、envelope・payload・recordのrun_idとartifact_id binding、J0 source lock、schemaが一致する。
2. Bの返却値はenvelope、payload、recordを含めてdeep-frozenであり、callerがnested valueをmutationしても保存bytesと次回reloadは元recordから変わらない。
3. Bのreopen/reloadではJ0 runnerを呼び出さず、runner invocation countは0である。これはartifactの読み戻しとhistorical replayを分離するためのpositive assertionである。

この検証はplanned verificationであり、R1のplanning sliceではruntime、test、fixtureを作成しない。

## Save・reload・listの結果契約（machine-readable）

後続実装のsave、reload、listは、OS例外やライブラリ固有の文字列をそのまま返さず、次の固定result envelopeへ正規化する。これはplanned contractであり、このsliceでruntimeを実装したことを意味しない。

成功結果はoperationごとにexact shapeを分け、余分なkeyを認めない。

- saveは`{ok, operation, status, artifact_id, run_id, record, binding}`だけを返す。`operation=save`、`record=null`であり、許可pairは`status=new`かつ`binding=created|recovered`、または`status=idempotent`かつ`binding=existing`の3通りだけである。
- reloadは同じ7 keyだけを返す。`operation=reload`、`status=loaded`、`record`は検証済みでrecursive deep-frozenなJ0 record、`binding=verified`である。
- listは`{ok, operation, status, items, count}`だけを返し、`artifact_id`、`run_id`、`record`、`binding`をrootに持たない。artifact storeはseparatorを含まないartifact_id由来locatorを使うflat layoutであり、listはcaller-owned root直下だけを走査してdirectoryへ再帰せず、symlinkをfollowしない。`status=empty`は`items=[]`・`count=0`、`status=committed`はroot直下の全committed artifactを`{artifact_id, run_id, binding=verified}`として返し、`artifact_id`のUTF-8 bytewise lexicographic昇順で一意に並べ、`count=items.length`とする。temporary、published-unbound、nested entryは含めない。temporaryはlist=`empty`・reload=`not_found`、published-unboundはlist=`empty`・reload=`binding_missing_or_mismatch`であり、いずれもcleanupしない。

失敗結果もoperationごとにexact shapeを分ける。save/reloadは`{ok=false, operation, status=error, code, artifact_id, run_id, record=null, effects}`、listは`{ok=false, operation=list, status=error, code, items=null, count=null, effects}`だけを返す。いずれの`effects`も`success_record_returned=false`、artifact/binding bytes変更なし、repair/overwrite/deleteなし、`runner_invocations=0`を必須値とする。

VibePro `0.2.0-beta.11`の`pr prepare`読戻しはAC-002・AC-011だけをmapped（2/11）、残り9件をunmappedとする。Taskの11/11 coverageとdraft clauseの13/13 `test_refs`はplanning contractであってPR-ready evidenceではない。別のimplementation/verification changeでaccepted Specと実test/evidenceを結合し`pr prepare`を再生成するまで、draftのaccepted化、証拠なしのfinal Spec、PR ready主張を禁止する。

固定error codeは次の通りである。`invalid_artifact_id`はartifact_idの形式不正、`invalid_path`はabsolute/NUL/separator/dot/URLなどlocator入力不正、`path_escape`はroot外解決、`schema_invalid`はenvelope/payload/record/JCS/schema不正、`integrity_mismatch`はstored bytes・canonical envelope・digest・identity不一致、`binding_missing_or_mismatch`はbinding欠落または別artifact指示、`non_regular_file`はsymlinkを含むregular file以外、`cross_filesystem`はreservation/binding/artifact rootのdevice不一致、`conflict`は同じrun_idの異なるcanonical content、`not_found`はcommitted artifact不在を表す。raw OS errorは契約ではない。

## Fresh process/store negative E2Eとfixture単位のassertion

後続の`tests/judgment-dag-artifact-store.test.ts`は、process/store Aが同一rootへfixtureをseedしてartifact bytes・binding bytesを記録して終了し、fresh process/store Bが同じrootをreopenして一操作だけ実行する二段階で検証する。Bは固定`code`とresult shapeを確認し、save/reload errorでは`record=null`、list errorでは`items=null`・`count=null`、全errorで`runner_invocations=0`、`repair_attempted=false`、`overwrite_attempted=false`、`delete_attempted=false`を確認する。最後にAのartifact・binding bytesとcommitted identityを再読込し、既存状態がbyte-for-byte不変であることを確認する。修復、overwrite、unlink、削除、暗黙cleanupはどのnegative caseでも発生してはならない。

| Fixture/assertion unit | Operation | Expected result |
| --- | --- | --- |
| one envelope byte tampered | reload | `integrity_mismatch`、success recordなし |
| envelope truncated | reload | `integrity_mismatch`、既存bytes不変 |
| envelope zero-byte | reload | `integrity_mismatch`、既存bytes不変 |
| canonical envelope renamed without binding（published-unbound） | reload | `binding_missing_or_mismatch`、list/reload成功値から不可視 |
| same-run exact published-unbound envelope | save | `status=new`、`binding=recovered`、cleanupなし |
| same-run different-content published-unbound envelope | save | `conflict`、新規公開・overwrite・deleteなし |
| malformed artifact_id | reload | `invalid_artifact_id` |
| unknown schema version or extra envelope field | reload | `schema_invalid`、success recordなし |
| binding points to a different artifact_id | reload | `binding_missing_or_mismatch` |
| no committed artifact at safe locator | reload | `not_found`、success recordなし |
| root-relative locator escapes root | reload | `path_escape` |
| absolute locator | reload | `invalid_path` |
| NUL-containing locator | reload | `invalid_path` |
| slash separator locator | reload | `invalid_path` |
| backslash separator locator | reload | `invalid_path` |
| dot segment locator | reload | `invalid_path` |
| URL-scheme locator | reload | `invalid_path` |
| reservation/artifact root on different device | save | `cross_filesystem`、atomic claimなし |
| symlink at locator | reload | `non_regular_file`、symlink followなし |
| directory at locator | reload | `non_regular_file` |
| device at locator | reload | `non_regular_file` |
| FIFO at locator | reload | `non_regular_file` |
| socket at locator | reload | `non_regular_file` |
| committed artifacts plus temporary/published-unbound files under caller-owned root | list | `status=committed`、items/count/binding/root scope exact、artifact_id UTF-8 bytewise lexicographic昇順、temporary/published-unbound除外、cleanupなし |
| unsafe absolute artifact root or locator | list | `invalid_path`、`items=null`・`count=null`、effects all zero、cleanupなし |
| temporary file listed | list | `status=empty`、`items=[]`・`count=0`、completed artifactとして不可視、cleanupなし |
| temporary file reloaded | reload | `not_found`、success recordなし、cleanupなし |
| published-unbound file listed | list | `status=empty`、`items=[]`・`count=0`、completed artifactとして不可視、cleanupなし |
| published-unbound file reloaded | reload | `binding_missing_or_mismatch`、success recordなし、cleanupなし |
| otherwise valid-looking committed envelope、temporary、published-unboundをnested directoryへ配置 | list | non-recursive、directory/symlinkをfollowせず全nested entryを除外、`status=empty`、cleanupなし |

各fixtureは個別のassertion idとmachine-readable evidence artifactを持ち、failure時のraw filesystem errorをsuccessや別codeへ丸めない。

## Canonical serialization

canonicalizationは独自規則を作らず、RFC 8785 JSON Canonicalization Scheme (JCS)を固定する。JCSのproperty sorting、ECMAScript互換のnumber serialization、string escaping、UTF-8、whitespaceなしの規則をそのまま適用する。J0 recordがJCS入力として不正、またはR1の許可schema外ならsaveを拒否する。

- JSON-compatible plain valueだけを許可し、undefined、function、symbol、bigint、NaN、Infinity、cycle、非plain object、sparse array、lone surrogateを拒否する。
- envelope・payload・recordのrequired field、unknown field、wrong type、三層run_id不一致、artifact schema version不一致を拒否する。
- object keyはJCSのUTF-16 code unit順で再帰的に並べる。J0 recordのarrayは意味上の順序を保持し、execution_order、runner_versions、nodes、dependency_outputsをsortしない。
- fixturesは少なくとも次を固定する（bytesはUTF-8）。`{"b":1,"a":2}` -> `{"a":2,"b":1}`、`{"n":-0}` -> `{"n":0}`、`{"n":1e-7}` -> `{"n":1e-7}`、`{"s":"é"}` -> 非ASCIIを不要にescapeしないJCS bytes、lone surrogate (`"\\uD800"`) -> reject。数値のNaN/Infinityもrejectする。
- `preimage_bytes`はJCS(payload)、保存bytesはJCS(envelope)であり、両者を同一bytesとして扱わない。digestはpreimageだけから計算する。

## Save state machine

`validated -> digest_computed -> run_reserved -> binding_checked -> temp_written -> atomically_renamed -> binding_created -> committed`

`run_reserved`より前は入力の純粋な検証・JCS計算だけで、artifact/bindingを公開しない。reservation取得後に既存bindingとcrash recovery対象を確認し、異内容の競合loserは`temp_written`より前にdenyする。

- `temp_written`: temp bytesは同一filesystem上にあるが、列挙・reload・bindingの対象外。
- `atomically_renamed`: canonical envelope fileが存在するが、binding作成までは`published-unbound`であり、通常のlist/reload/APIから不可視。
- `binding_created`: create-once bindingが同じartifact_idを指した時だけcompleted artifactとして可視。
- `committed`: bindingとenvelopeのintegrityを再確認した成功状態。
- lock中の失敗はbindingを作成せず、tempをownerがcleanupする。crash後に残るtempは不可視で、将来の明示的maintenance storyだけが同じreservation境界でcleanupする。
- crash後に残る`published-unbound`はcompleted artifactではなく、save/reloadの暗黙cleanup対象でもない。次回同じrun_idのlock保持者は、要求envelopeと完全一致する時だけcreate-once bindingで回復し、異なる要求なら新しいartifactを公開せずdenyする。unbound fileを削除・再利用するcleanupはこのStoryの外側でのみ行う。

同じrun_idの同時writerはper-run lockで直列化する。同じcanonical payloadなら既存bindingを検証してidempotentに返し、異なるpayloadなら最初のbindingを守り後続をconflictにする。last-write-wins、部分bytesの勝利、競合時の削除を認めない。

## Reloadとintegrity verification

reloadはcallerのartifact_idから固定されたrelative locatorだけを導出する。入力をpathとして連結せず、root外へ出る値やsymlinkをfollowしない。read後、次の順に検証する。

1. locatorがartifact_idの許可された形式と一致し、root内のregular fileである。
2. bytesが空でなく、完全なUTF-8 JSONとしてparseできる。
3. envelope schema、artifact schema version、`envelope.run_id`、`payload.run_id`、`payload.record.run_id`を検証し、三つが完全一致することを確認する。
4. payloadをJCSで再シリアライズしてartifact_idを再計算し、stored artifact_idとcallerのexpected artifact_idが一致することを確認する。
5. envelope全体をJCSで再シリアライズし、stored envelope bytesとbyte-for-byte一致することを確認する。追加whitespace、field順変更、outer run_id差替え、payload/record run_id差替えは拒否する。
6. run_id bindingが同じartifact_idを指し、J0 recordの現行shape・source lockが有効であることを確認する。bindingのないpublished-unbound fileは成功値として返さない。
7. parse objectをstorage bufferから分離し、envelope・payload・recordを再帰的にdeep-freezeして返す。

tamper、truncation、zero-byte、JSON追加field、digest差替え、三層のrun_id差替え、未知version、partial write、bindingなしartifactを成功値へ変換しない。失敗は識別可能なmachine-readable errorであり、修復のために既存artifactを自動変更しない。

## Filesystem安全境界

- artifact_idはsha256:に64桁のlowercase hexadecimalを続けた固定形式だけを受理し、slash、backslash、dot segment、NUL、absolute path、URL schemeを拒否する。
- run_idはraw path segmentにせず、bindingのlocatorへ安全に符号化する。符号化前後のroot containmentを検証する。
- root以下のlocatorにsymlink、非regular file、外部mountへの意図しない追従、parent traversalがある場合は拒否する。
- final targetはcreate-onlyまたはcompare-onlyで扱い、rename後のoverwriteを行わない。
- temporary artifactとpublished-unbound artifactはcompleted artifactと別の明示的な状態であり、通常の列挙・reload対象外とする。cleanupはそれぞれownerまたは将来のmaintenance storyだけがlock境界内で行う。
- reservation、binding、artifact rootのdeviceが異なる場合はcross-filesystem atomic claimを試さずrejectする。

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

このplanning sliceのallowed pathsは次の6つだけである。`.vibepro/config.json`は既存のVibePro story登録・current story切替を保持するための正規化された設定変更であり、他storyの内容を変更しない。

- docs/management/stories/active/story-r1-local-immutable-run-artifact-store.md
- docs/architecture/story-r1-local-immutable-run-artifact-store.md
- docs/specs/r1-local-immutable-run-artifact-store.md
- docs/management/tasks/r1-local-immutable-run-artifact-store.json
- .vibepro/spec/story-r1-local-immutable-run-artifact-store/draft.json
- .vibepro/config.json

`current_story_id`をR1へ切り替える運用影響は、VibeProの未指定コマンドがR1を既定対象にすることだけであり、明示的な`--story-id`を付けた既存storyのレビュー・artifact・判定には影響しない。この境界は後続のdisposable fixtureで、R1をcurrentに保ったまま代表的なJ0明示指定コマンドを実行し、選択storyと生成先がJ0だけであること、R1のreview/artifact bytesとGit状態が不変であることをreadbackして証明する。証跡は`.vibepro/evidence/story-r1-local-immutable-run-artifact-store/coverage/AC-010-explicit-j0-story-isolation.json`へ分離し、不一致・R1 mutation・暗黙fallbackのいずれかがあればreleaseをblockする。src、tests、contracts、package、database、migration、Graph、MCP、CLI、HTTP、customer data、secret、deployment、mana-runtime、他worktreeはforbiddenである。
