# 仕様: UnsonOS 現場責任者 v0実装

## 文書メタ情報

- 状態: 有効
- 種別: 仕様
- 主題: 現場責任者 v0実装
- 親文書: [現場責任者 v0導線運用型仕様](./unson-os-lead-v0-operating-model-spec.md)
- 派生元: [現場責任者コンソール UI遷移仕様](./unson-os-lead-control-console-ui-spec.md)
- 関連文書: [UnsonOS 現場責任者コンソール](../architecture/unson-os-lead-control-console.md), [UI×制御面 整合性マトリクス](../architecture/unson-os-ui-architecture-alignment.md)
- 置換: なし

## 目的

この仕様は、現場責任者コンソール v0 を実装するために必要な `command / event / record / policy / state transition` を固定する。

対象は次の 1 本導線に限定する。

`停滞中の施策 -> 状況要約 -> 証跡確認 -> 成果物要求 or 再割り振り -> 上申資料 -> 判断記録`

この文書では、画面名の説明ではなく、実装者がそのまま組める接続順を正本化する。

## 実装対象

### 対象に含める

- `即応パネル` の状態別裁定フロー
- `論点整理室` への送出条件
- `判断待ち一覧` へ上がる `上申資料`
- `判断メモ` と参照 `transcript / trace / evidence`
- UI 操作から `command -> policy -> object更新 -> event -> 再投影` までの流れ

### 対象に含めない

- 経営者面の command 詳細
- 裁量昇格候補の本実装
- runtime ごとの差異吸収の wire protocol
- Brainbase 側 UI の詳細

## object の実装単位

| object | 必須 ID | 必須フィールド | 更新主体 |
| --- | --- | --- | --- |
| 施策 | `initiative_id` | `district_id`, `stage`, `scope`, `execution_health`, `evidence_state`, `approval_state`, `escalation_state`, `attention_level` | 制御面 |
| 判断項目 | `decision_item_id` | `initiative_id`, `decision_type`, `status`, `recommended_option_id`, `owner_role`, `opened_at` | 制御面 / 人間 |
| 成果物要求 | `artifact_request_id` | `decision_item_id`, `required_artifacts[]`, `requested_to`, `due_at`, `status` | 現場責任者 |
| 再割り振り指示 | `reroute_instruction_id` | `decision_item_id`, `selected_option_id`, `routing_change`, `priority_band`, `status` | 現場責任者 |
| 上申資料 | `escalation_packet_id` | `decision_item_id`, `options[]`, `recommended_option_id`, `impact_scope`, `missing_evidence[]`, `owner_comment`, `submitted_to` | 判断資料生成サービス / 現場責任者 |
| 判断メモ | `decision_memo_id` | `decision_item_id`, `decision`, `rationale`, `evidence_refs[]`, `transcript_refs[]`, `review_condition` | 判断資料生成サービス / 現場責任者 |
| 証跡参照 | `evidence_ref_id` | `target_type`, `target_id`, `source_kind`, `source_url`, `label` | 制御面 |

## command 一覧

| command | 発行元 | 入力 | 成功時の主更新 |
| --- | --- | --- | --- |
| `askForBrief` | 即応パネル | `initiative_id` | 状況要約投影を更新 |
| `askForEvidenceReview` | 即応パネル | `initiative_id` | 証跡確認票投影を更新 |
| `requestArtifact` | 即応パネル | `decision_item_id`, `required_artifacts[]`, `requested_to`, `due_at` | `成果物要求` 作成、`判断項目.status=artifact_requested` |
| `setArtifactDueDate` | 即応パネル | `artifact_request_id`, `due_at` | `成果物要求.due_at` 更新 |
| `proceedWithAlternativeEvidence` | 即応パネル | `decision_item_id`, `alternative_evidence_refs[]`, `rationale` | `判断メモ` 作成、`判断項目.status=alternative_evidence_accepted` |
| `rerouteExecution` | 即応パネル / 進行レーン | `decision_item_id`, `selected_option_id`, `routing_change`, `priority_band` | `再割り振り指示` 作成、必要時のみ `実行要求` 更新 |
| `shrinkScopeAndContinue` | 即応パネル | `decision_item_id`, `reduced_scope`, `selected_option_id` | `施策.scope` 更新、`判断項目.status=scope_reduced` |
| `approveDecisionItem` | 即応パネル / 判断待ち一覧 | `decision_item_id`, `selected_option_id` | `判断メモ` 作成、`承認状態=承認済み` |
| `approveDecisionItemWithConstraint` | 即応パネル / 判断待ち一覧 | `decision_item_id`, `selected_option_id`, `constraints[]` | `判断メモ` 作成、`承認状態=条件付き承認済み` |
| `returnDecisionItem` | 即応パネル / 判断待ち一覧 | `decision_item_id`, `reason`, `required_followup[]` | `承認状態=差戻し`, `連絡項目` 作成 |
| `retryExecutionPlan` | 即応パネル | `decision_item_id`, `selected_option_id` | `実行要求.retry_count` 増加、`実行健全性=再試行中` |
| `executeViaAlternateRoute` | 即応パネル | `decision_item_id`, `selected_option_id`, `alternate_route` | `再割り振り指示` 作成、`実行要求.route` 更新 |
| `handoffToRecoveryOwner` | 即応パネル | `decision_item_id`, `recovery_owner_role` | `判断項目.owner_role` 更新、`連絡項目` 作成 |
| `pauseAndStabilize` | 即応パネル | `decision_item_id`, `reason`, `open_briefing_room` | `実行健全性=停止`, `判断項目.status=stabilizing` |
| `sendToBriefingRoom` | 即応パネル | `decision_item_id`, `selected_option_id` | `論点整理室コンテキスト` 作成 |
| `createEscalationPacket` | 論点整理室 | `decision_item_id`, `options[]`, `recommended_option_id`, `impact_scope`, `missing_evidence[]`, `owner_comment` | `上申資料` 作成、`上申状態=上申中` |
| `recordDecision` | 即応パネル / 論点整理室 | `decision_item_id`, `decision`, `rationale`, `evidence_refs[]`, `transcript_refs[]`, `review_condition` | `判断メモ` 作成、`判断項目` 更新 |
| `holdDecisionItem` | 即応パネル | `decision_item_id`, `reason` | `判断項目.status=on_hold` |

## event 一覧

| event | 発火元 | payload |
| --- | --- | --- |
| `briefPrepared` | 対話支援サービス | `initiative_id`, `summary`, `causes[]`, `candidate_actions[]` |
| `evidenceReviewPrepared` | 対話支援サービス | `initiative_id`, `missing_evidence[]`, `request_targets[]`, `due_candidates[]` |
| `artifactRequested` | 制御面 | `artifact_request_id`, `decision_item_id`, `due_at` |
| `artifactDueDateSet` | 制御面 | `artifact_request_id`, `due_at` |
| `alternativeEvidenceAccepted` | 制御面 | `decision_item_id`, `evidence_refs[]` |
| `rerouteIssued` | 制御面 | `reroute_instruction_id`, `decision_item_id`, `routing_change` |
| `scopeShrunk` | 制御面 | `decision_item_id`, `reduced_scope` |
| `decisionApproved` | 制御面 | `decision_item_id`, `decision_memo_id` |
| `decisionApprovedWithConstraint` | 制御面 | `decision_item_id`, `constraints[]`, `decision_memo_id` |
| `decisionReturned` | 制御面 | `decision_item_id`, `reason`, `required_followup[]` |
| `executionRetried` | 制御面 | `decision_item_id`, `retry_count` |
| `executionRerouted` | 制御面 | `decision_item_id`, `alternate_route` |
| `recoveryOwnerAssigned` | 制御面 | `decision_item_id`, `recovery_owner_role` |
| `executionStabilizationStarted` | 制御面 | `decision_item_id`, `reason` |
| `briefingRoomRequested` | 制御面 | `decision_item_id`, `selected_option_id` |
| `escalationPacketCreated` | 判断資料生成サービス | `escalation_packet_id`, `decision_item_id`, `submitted_to` |
| `decisionRecorded` | 判断資料生成サービス | `decision_memo_id`, `decision_item_id` |
| `decisionHeld` | 制御面 | `decision_item_id`, `reason` |

## policy 適用順

すべての mutating command は次の順に評価する。

1. 閲覧 / 操作権限 policy
2. 状態整合 policy
3. 証跡必須 policy
4. 承認 / 上申 policy
5. 判断記録 policy

### command ごとの適用表

| command | 必須 policy |
| --- | --- |
| `requestArtifact` | 操作権限, 証跡必須 |
| `setArtifactDueDate` | 操作権限 |
| `proceedWithAlternativeEvidence` | 操作権限, 証跡必須, 判断記録 |
| `rerouteExecution` | 操作権限, 状態整合 |
| `shrinkScopeAndContinue` | 操作権限, 状態整合 |
| `approveDecisionItem` | 操作権限, 承認 / 上申, 判断記録 |
| `approveDecisionItemWithConstraint` | 操作権限, 承認 / 上申, 判断記録 |
| `returnDecisionItem` | 操作権限, 承認 / 上申 |
| `retryExecutionPlan` | 操作権限, 状態整合 |
| `executeViaAlternateRoute` | 操作権限, 状態整合 |
| `handoffToRecoveryOwner` | 操作権限, 承認 / 上申 |
| `pauseAndStabilize` | 操作権限, 状態整合 |
| `sendToBriefingRoom` | 閲覧 / 操作権限 |
| `createEscalationPacket` | 操作権限, 承認 / 上申, 判断記録 |
| `recordDecision` | 操作権限, 判断記録 |
| `holdDecisionItem` | 操作権限 |

## record の必須形

### 証跡確認票

- `initiative_id`
- `decision_item_id`
- `missing_evidence[]`
- `request_targets[]`
- `due_candidates[]`
- `generated_at`

### 上申資料

- `escalation_packet_id`
- `decision_item_id`
- `current_state`
- `options[]`
- `recommended_option_id`
- `impact_scope`
- `missing_evidence[]`
- `owner_comment`
- `submitted_to`
- `created_at`

### 判断メモ

- `decision_memo_id`
- `decision_item_id`
- `decision`
- `rationale`
- `evidence_refs[]`
- `transcript_refs[]`
- `review_condition`
- `recorded_by`
- `recorded_at`

## 状態別の裁定卓遷移

### 成果物不足

| 操作 | 事前条件 | 更新 | event | 再投影 |
| --- | --- | --- | --- | --- |
| `成果物を要求` | `証跡状態=成果物不足` | `成果物要求` 作成 | `artifactRequested` | `証跡確認票`, `判断待ち一覧` |
| `期限を付ける` | 既存 `成果物要求` あり | `成果物要求.due_at` 更新 | `artifactDueDateSet` | `証跡確認票`, `停滞一覧` |
| `代替証跡で進める` | `alternative_evidence_refs[]` 入力済み | `判断メモ` 作成 | `alternativeEvidenceAccepted`, `decisionRecorded` | `進行レーン`, `判断待ち一覧` |
| `再割り振り` | `selected_option_id` あり | `再割り振り指示` 作成 | `rerouteIssued` | `進行レーン`, `稼働状況パネル` |
| `上申資料を作成` | 3案比較が埋まっている | `上申資料` 作成 | `escalationPacketCreated` | `判断待ち一覧`, `連絡面` |

### 停滞中

| 操作 | 事前条件 | 更新 | event | 再投影 |
| --- | --- | --- | --- | --- |
| `再割り振り` | `実行健全性=停滞中` | `再割り振り指示` 作成 | `rerouteIssued` | `進行レーン`, `稼働状況パネル` |
| `範囲を縮小して進める` | `reduced_scope` あり | `施策.scope` 更新 | `scopeShrunk` | `進行レーン`, `判断待ち一覧` |
| `一時停止` | `reason` あり | `実行健全性=停止` | `executionStabilizationStarted` | `進行レーン`, `停滞一覧` |
| `論点整理室へ送る` | `selected_option_id` あり | `論点整理室コンテキスト` 作成 | `briefingRoomRequested` | `論点整理室` |

### 承認待ち

| 操作 | 事前条件 | 更新 | event | 再投影 |
| --- | --- | --- | --- | --- |
| `承認` | `承認状態=承認待ち` | `承認状態=承認済み` | `decisionApproved`, `decisionRecorded` | `判断待ち一覧`, `進行レーン` |
| `差戻し` | `reason` あり | `承認状態=差戻し` | `decisionReturned` | `判断待ち一覧`, `連絡面` |
| `条件付き承認` | `constraints[]` あり | `承認状態=条件付き承認済み` | `decisionApprovedWithConstraint`, `decisionRecorded` | `判断待ち一覧`, `進行レーン` |
| `上申資料を作成` | 上位判断が必要 | `上申資料` 作成 | `escalationPacketCreated` | `判断待ち一覧`, `連絡面` |

### 実行失敗

| 操作 | 事前条件 | 更新 | event | 再投影 |
| --- | --- | --- | --- | --- |
| `再実行` | `retry_count < retry_limit` | `retry_count` 増加 | `executionRetried` | `進行レーン`, `稼働状況パネル` |
| `別経路で実行` | `alternate_route` あり | `実行要求.route` 更新 | `executionRerouted` | `進行レーン`, `稼働状況パネル` |
| `回復担当に渡す` | `recovery_owner_role` あり | `判断項目.owner_role` 更新 | `recoveryOwnerAssigned` | `判断待ち一覧`, `役付きAI帯` |
| `停止して整理` | `reason` あり | `実行健全性=停止`, `論点整理室コンテキスト` 作成 | `executionStabilizationStarted`, `briefingRoomRequested` | `進行レーン`, `論点整理室` |

## 画面操作からの流れ

### 建物押下

1. UI が `filterByBuilding(building_id)` を内部適用する
2. 即応パネルの初期タブを切り替える
3. 対応する施策を 1 件選んだ時点で `askForBrief` または `askForEvidenceReview` を発行する

### 異常地点押下

1. UI が `focusAnomaly(anomaly_id)` を内部適用する
2. 直ちに `askForBrief` を発行する
3. 右の裁定卓に `推奨アクション 1 / 代替案 2 / 代替案 3` を出す

### AI押下

1. UI が `openActorCard(actor_id)` を内部適用する
2. `担当カード` を出す
3. 現場責任者が対象施策を選び直した時だけ mutating command を許可する

## 詳細作業面へ降りる条件

v0 で `Brainbase` へ降りてよいのは次だけに限定する。

- 原因候補が 2 系統以上に割れている
- 再試行が 2 回以上失敗している
- `evidence_refs` と `transcript_refs` に矛盾がある

それ以外は `即応パネル` か `論点整理室` で裁く。

## 受け入れ条件

- すべての状態別ボタンが 1 つの command に一意対応している
- すべての mutating command に `policy -> object更新 -> event -> 再投影` が定義されている
- `判断メモ` と `上申資料` の両方に `evidence_refs / transcript_refs` の参照関係が残る
- UI は queue を直接更新せず、必要時のみ制御面経由で `実行要求` を更新する
- `Brainbase` への降下条件が 3 条件に限定されている
- `停止して整理` は `pauseAndStabilize(open_briefing_room=true)` と同義で、停止と同時に `論点整理室` を開く
