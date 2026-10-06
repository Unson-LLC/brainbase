---
spec_id: story-meeting-minutes-judgment-lineage-v1
story_id: story-meeting-minutes-judgment-lineage-v1
status: draft
spec_maturity: contract_review
implementation_ready: false
owner_repository: brainbase
storage_boundary: minutes-owned-source-plus-lineage-sidecar
---

# 議事録の判断・Task系譜 v1 仕様（Draft）

## 目的

この仕様は、議事録の特定版を根拠にした判断候補・Task候補と、明示的に採用された対象を同じ系譜で辿れるようにする。本文、判断の正本、Taskの正本、実行のreceiptはそれぞれの所有者に残し、このStoryは版を固定した参照と状態の履歴だけを持つ。

確認は候補の根拠を確認した操作、採用は人が対象を選んだ操作、実行は外部hostが実際に行った操作、結果受容は実行結果を別途受け入れた操作である。これらを一つの成功状態へ畳み込まない。

## 依存と所有境界

- 議事録の会議・本文・版・確認履歴は `story-meeting-minutes-native-lifecycle-v1` のstoreを正本とする。系譜は本文を複製しない。
- `MinutesVersionPort` は指定された会議ID・議事録ID・版IDを現在のACLで読み、同じ版のdigest・provenance・根拠箇所(locator)を返す。指定版が読めない場合は `denied` / `unavailable` / `integrity_mismatch` を返し、current版へ置き換えない。
- 判断の採用は既存のKnowledge promotionまたはlearning adoptionのprovider、Taskは既存Canonical Task service、実行の確認は既存receipt adapterまたはhost-owned receipt portを注入する。系譜moduleは判断・Taskの別正本や実行engineを作らない。
- 保存は `evidence/meeting-minutes-lineage.json` のappend-only sidecarとし、既存のcanonical SSOT lock・atomic readbackを使う。本文・録音・raw connector payload・秘密情報は保存しない。

## 正本参照

### 議事録版の参照

`MinutesVersionReference` は次を必須とする。

- `meeting_id`, `minutes_id`, `version_id`
- `content_digest`（sourceが記録した値。未記録を計算値で補わない）
- `locator`（本文内の根拠箇所またはsource locator）
- `provenance`（provider kind/id/revision/digestのexact参照）

作成時に返ったcanonical referenceをsidecarへ保存し、read時にminutes providerへ同じ参照を渡す。ACL・存在・版・digestが一致しない場合はlineage全体を成功として返さない。

### 採用対象の参照

判断とTaskのrecordは対象本文を持たず、既存providerのexact locatorだけを持つ。

- Judgment: providerが返す判断・採用recordの `kind / id / revision / digest` と採用receipt/authority locator
- Task: Canonical Taskの `id / version` と作成operation/idempotency locator
- Execution: host-owned receiptの `id / digest` と対象のexact revision
- Result: 結果受容recordの `id / digest`。未記録は `unrecorded` として残す

provider未接続、権限不足、対象の削除・版不一致は `unavailable` 等で明示し、空の成功recordや擬似対象を作らない。

## ライフサイクル

1. `createCandidate` は指定版を再読し、exact `MinutesVersionReference`、根拠箇所、provenance、候補種別（`judgment` または `task`）、`confirmed` / `inferred` の区別、候補のproposal digest、actor、時刻を保存する。`inferred` は本文由来の確定事実として扱わない。
2. `confirmCandidate` は候補の根拠を人が確認した記録をappendする。確認済みでも判断・Taskの採用や実行は発生しない。
3. `adoptJudgment` または `adoptTask` は確認済み候補に対する明示操作として、actor、target exact reference、adoption receipt、idempotency key、request digestを保存する。外部providerが採用できない場合は採用済みと記録しない。
4. 実行hostが実行した後、既存receiptを再読してexact対象版とrun idを検証し、`execution`を別recordとして保存する。planned選択とactual実行を混同しない。
5. `acceptResult` は実行結果を人または既存の結果providerが受け入れた場合だけrecordする。これは採用・実行の状態を変更しない。
6. `markCorrection` は旧版を不変のまま残し、新版のexact referenceと訂正理由をappendする。旧版から採用された判断・Taskに `review_required` を付けるが、Task取消し・判断上書き・再実行は行わない。

## 公開API（最小境界）

具体的なcoreの型名は依存Storyの契約レビューで確定する。意味上の境界は次のとおり。

- `createMinutesLineageStore({ dataDir, minutes, judgment, task, receipt, now })`
- `createCandidate({ id, idempotencyKey, actor, evidence, kind, proposal, epistemicState })`
- `confirmCandidate({ id, idempotencyKey, candidateId, actor, evidenceDigest })`
- `adoptJudgment({ id, idempotencyKey, candidateId, target, actor })`
- `adoptTask({ id, idempotencyKey, candidateId, target, actor })`
- `recordExecution({ id, idempotencyKey, lineageId, receiptRef, actor })`
- `acceptResult({ id, idempotencyKey, lineageId, resultRef, actor })`
- `markCorrection({ id, idempotencyKey, previousVersion, replacementVersion, actor, reason })`
- `readByMinutesVersion({ meetingId, minutesId, versionId, access })`
- `readByTarget({ kind, id, revision, access })`

同一候補・同一操作の同一request digestは冪等に既存recordを返す。同じidempotency keyまたは同じ論理対象に別内容を渡した場合は `revision_conflict` とする。同じ議事録版から異なる候補・proposalを複数作れる。採用の重複抑止単位は候補（候補digestと対象種別）であり、同じ候補の再試行では別の判断・Taskを作らない。

## 不変条件

- `confirmation_status`、`adoption_status`、`execution_status`、`result_status` は別フィールドで保持し、確認から採用・実行へ暗黙遷移しない。
- 同一議事録版から複数の候補・対象を保持でき、版全体を一件へ潰さない。
- 系譜の全readで議事録版・対象・receiptを現在ACLで再検証する。過去に保存した権限やcurrent版の値を代用しない。
- 議事録版から採用対象へ、採用対象から同じ議事録版へ、同じexact referenceで双方向検索できる。
- 訂正はappend-onlyであり、旧版・旧採用・旧receiptを上書きしない。影響対象は `review_required` として読める。
- providerが未接続、receiptが未確認、結果が未記録の場合は明示的な未完了状態を返す。成功、完了、採用済みへ補完しない。
- organizationのmember/role/tenant権限はorganization側のproviderへ戻し、OSSのsidecarから推測しない。

## UI hook

OSSのcore shared UIは、詳細画面の任意 action slotへlineage view modelを渡せるhookだけを提供する。lineageは `ui/meeting-minutes-lineage.js` とCSSで、根拠版、候補、採用対象、確認要否、取得不能理由を表示する。adoption/Task providerが未接続の場合は無効な操作を黙って並べず、未接続理由と正本の接続状態を表示する。library exportだけを画面受入の完了とは扱わない。

## 検証

- exact meeting/minutes/version/evidence digestとprovenanceを保存し、current版への置換、digest改変、ACL拒否、過去版不在をfail closedにする。
- confirmationだけではadoption/executionが変わらず、明示adoptionだけがtarget referenceを作る。
- 同じcandidate/adoption/Taskのretryは一件に収束し、異なるrequest digestは `revision_conflict` になる。
- adopted judgmentとTaskの両方向lookupが同じ版を返す。
- 訂正で旧recordを残したまま影響対象だけ `review_required` になり、Task取消し・再実行が呼ばれない。
- provider未接続、権限不足、receipt未読、result未記録を `unavailable` / `denied` / `unrecorded` として実画面へ表示する。
- `npm run build`、lineage unit tests、core UIの実画面readbackを実行する。外部組織providerの実利用者受容は別Storyの証跡として扱う。

## 対象外

AIによる自動抽出、全文書への波及解析、議事録本文のcanonical Graph複製、判断・Task正本の再実装、Task自動取消し・再実行、外部provider全対応、組織権限管理、結果の自動受容は対象外とする。
