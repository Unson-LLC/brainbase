# 仕様: UnsonOS 現場責任者 v0導線運用型

## 文書メタ情報

- 状態: 有効
- 種別: 仕様
- 主題: 現場責任者 v0導線運用型
- 親文書: [UnsonOS 現場責任者ランタイム構成](../architecture/unson-os-lead-runtime-architecture.md)
- 派生元: [UnsonOS 現場責任者 v0導線運用型](../stories/unson-os-lead-workflow-validation-story.md)
- 関連文書: [UnsonOS 現場責任者コンソール](../architecture/unson-os-lead-control-console.md), [UnsonOS UI×制御面 整合性マトリクス](../architecture/unson-os-ui-architecture-alignment.md), [現場責任者 v0実装](./unson-os-lead-v0-implementation-spec.md)
- 置換: なし

## 目的

この仕様は、現場責任者が `停滞中の施策` を起点に

`状況要約 -> 証跡確認 -> 成果物要求 or 再割り振り -> 上申資料 -> 判断記録`

を end-to-end で回すための最小仕様を固定する。

v0 では、事業責任者の `判断待ち一覧` に上申資料が載るところまでを対象にする。

## v0 の対象

### 対象に含める

- 現場責任者が停滞中の施策を選ぶ
- `即応パネル` で `状況要約 / 証跡確認 / 割り振り支援` を行う
- `成果物要求` または `再割り振り` を行う
- 必要時に `論点整理室` で上申資料を生成する
- `判断メモ` を残す
- `上申資料` を事業責任者の `判断待ち一覧` に載せる

### 対象に含めない

- 経営者まで含む多段の上申連鎖
- 裁量昇格候補の本格運用
- すべての進行段階の完了条件
- runtime ごとの差異吸収の詳細仕様

## object

| object | ID | 親 | 正本 | 更新主体 | 用途 |
| --- | --- | --- | --- | --- | --- |
| 施策 | `initiative_id` | 区画 | `UnsonOS` | 制御面 / 人間 | 停滞中の対象 |
| 判断項目 | `decision_item_id` | 施策 | `UnsonOS` | 制御面 / 人間 | 裁くべき項目 |
| 成果物要求 | `artifact_request_id` | 判断項目 | `UnsonOS` | 現場責任者 | 不足成果物の要求 |
| 再割り振り指示 | `reroute_instruction_id` | 判断項目 | `UnsonOS` | 現場責任者 | 実行枠や担当の変更 |
| 上申資料 | `escalation_packet_id` | 判断項目 | `UnsonOS` | 判断資料生成サービス / 現場責任者 | 事業責任者へ上げる資料 |
| 判断メモ | `decision_memo_id` | 判断項目 | `UnsonOS` | 判断資料生成サービス / 現場責任者 | 現場責任者の裁定記録 |
| 証跡参照 | `evidence_ref_id` | 施策 or 判断項目 | `UnsonOS` 参照 | 制御面 / 外部成果物側 | Drive / GitHub / Notion 等の参照 |

## v0 で使う状態軸

### 進行段階

- `調査`
- `計画`
- `実行`
- `検証`
- `承認`

v0 では `検証` と `承認` を主に扱う。

### 実行健全性

- `正常`
- `停滞中`
- `実行失敗`

### 証跡状態

- `充足`
- `成果物不足`

### 承認状態

- `不要`
- `承認待ち`
- `差戻し`

### 上申状態

- `なし`
- `上申中`

### 注意度

- `通常`
- `要注意`
- `高優先`

## command

| command | 発行元 UI | 入力 | 主な副作用 |
| --- | --- | --- | --- |
| `askForBrief` | 即応パネル | `initiative_id` | 状況要約を生成する。正本更新なし |
| `askForEvidenceReview` | 即応パネル | `initiative_id` | 不足証跡一覧を生成する。正本更新なし |
| `requestArtifact` | 即応パネル / 停滞一覧 | `decision_item_id`, `required_artifacts[]`, `due_at` | `成果物要求` を作成し、連絡項目を生成する |
| `rerouteExecution` | 即応パネル / 進行レーン | `decision_item_id`, `reroute_plan`, `priority_band` | `再割り振り指示` を作成し、必要時のみ実行要求を更新する |
| `createEscalationPacket` | 論点整理室 | `decision_item_id`, `options[]`, `recommended_option`, `impact_scope`, `missing_evidence[]`, `owner_comment` | `上申資料` を作成し、事業責任者の `判断待ち一覧` に載せる |
| `recordDecision` | 即応パネル / 論点整理室 | `decision_item_id`, `decision`, `rationale`, `evidence_refs[]`, `transcript_refs[]` | `判断メモ` を作成し、`判断項目` を更新する |

## command ごとの policy

| command | 通る policy |
| --- | --- |
| `askForBrief` | 閲覧権限 policy |
| `askForEvidenceReview` | 閲覧権限 policy |
| `requestArtifact` | 証跡必須 policy、閲覧権限 policy |
| `rerouteExecution` | 権限 policy、段階遷移ゲート、例外ゲート |
| `createEscalationPacket` | 上申 policy、判断記録 policy |
| `recordDecision` | 判断記録 policy、監査参照 policy |

## v0 の標準出力

### 状況要約

最低限含む項目:

- 主因
- 副因
- 現在段階
- 停滞時間 or 失敗回数
- 次の候補操作

### 証跡確認票

最低限含む項目:

- 不足証跡
- 要求先
- 期限
- 関連施策
- 関連判断項目

### 上申資料

最低限含む項目:

- 現在状態
- 進める案
- 縮小案
- 停止案
- 推奨案
- 影響範囲
- 足りない証跡
- 現場責任者コメント

### 判断メモ

最低限含む項目:

- 裁いた内容
- 判断理由
- 参照証跡
- 参照 transcript / trace
- 次回見直し条件

## 完了条件

### 状況要約の完了

- 主因が 1 つ以上出ている
- 現在段階が特定されている
- 次の候補操作が 1 つ以上出ている

### 証跡確認の完了

- 不足証跡が列挙されている
- 要求先と期限が埋まっている

### 成果物要求の完了

- `成果物要求` object が作成されている
- 関連施策と期限が紐づいている

### 再割り振りの完了

- `再割り振り指示` object が作成されている
- 優先度または担当変更が確定している
- 必要時のみ実行要求への反映が行われている

### 上申資料の完了

- 3 案の比較がある
- 推奨案が 1 つに絞られている
- 影響範囲と足りない証跡が入っている
- 事業責任者の `判断待ち一覧` に載る

### 判断記録の完了

- `判断メモ` が作成されている
- `判断理由` がある
- `evidence_refs` と `transcript_refs` が結ばれている

## UI との接続

| UI | 読むもの | 出す command | 主成果物 |
| --- | --- | --- | --- |
| 判断待ち一覧 | `判断項目`, `承認状態`, `証跡状態`, `上申状態` | `recordDecision`, `createEscalationPacket` | 判断メモ, 上申資料 |
| 進行レーン | `施策`, `進行段階`, `実行健全性` | `rerouteExecution`, `requestArtifact` | 再割り振り指示, 成果物要求 |
| 即応パネル | 状況要約, 不足証跡, 選択肢 | `askForBrief`, `askForEvidenceReview`, `requestArtifact`, `rerouteExecution` | 証跡確認票, 成果物要求 |
| 論点整理室 | 施策, 判断項目, 証跡, transcript 参照 | `createEscalationPacket`, `recordDecision` | 上申資料, 判断メモ |

## 区画巡回マップの操作仕様

### 建物を押したとき

建物は `進行レーン` の絞り込み対象として扱う。

| 建物 | フィルタ | 即応パネル初期タブ |
| --- | --- | --- |
| 実行棟 | 実行段階の施策 | `状況要約` |
| 検証棟 | 検証段階の施策 | `割り振り支援` |
| 証跡庫 | `成果物不足 / 証跡確認待ち` の施策 | `証跡確認` |
| 承認ゲート | `承認待ち / 差戻し中` の施策 | `リスク確認` |

建物クリックでは `論点整理室` を直接開かない。

### AI を押したとき

AI の主反応は `担当カード` を開くことに固定する。

担当カードの最小項目:

- 名前
- 職能
- 担当建物
- 今扱っている施策
- 裁量範囲
- 今の短文思考
- ここからできる操作

担当カードから許可する二次操作:

- `focusByAssignedInitiatives`
- `biasOpsDockToActor`

### 異常地点を押したとき

異常地点の主反応は `即応パネル` を開くことに固定する。

初期表示の最小項目:

- 状況要約
- 原因候補
- 推奨アクション
- 即断ボタン

## 役付きAI帯の表示仕様

### 通常時

常設表示は 4 体までとする。  
表示優先順は次で固定する。

1. 今、持ち場で動いている
2. 停滞や承認待ちに関わっている
3. 現場責任者が直近で触った

### 展開時

`役付きAIをもっと見る` で一覧を開き、フィルタは次だけを持つ。

- 全員
- 今アクティブ
- 要注意案件を担当中
- 待機中

## 即応パネルの表示仕様

即応パネルは 3 段構成に固定する。

### 上段

- 今の状態
- 主因
- 副因
- 全体リスク
- 関係AI

状態別の補助項目:

- `成果物不足`: `必要証跡`
- `承認待ち`: `承認論点`, `必要証跡`
- `実行失敗 / 停滞中`: `影響範囲`

### 中段

- `推奨アクション 1`
- `代替案 2`
- `代替案 3`

各案の最小項目:

- 案の要約
- 想定リスク
- 必要証跡
- 承認要否

### 下段

下段は状態別に切り替える。

#### 成果物不足

- `requestArtifact`
- `setArtifactDueDate`
- `proceedWithAlternativeEvidence`
- `rerouteExecution`
- `createEscalationPacket`

#### 承認待ち

- `approveDecisionItem`
- `approveDecisionItemWithConstraint`
- `returnDecisionItem`
- `createEscalationPacket`

#### 停滞中

- `rerouteExecution`
- `shrinkScopeAndContinue`
- `pauseAndStabilize`
- `sendToBriefingRoom`

#### 実行失敗

- `retryExecutionPlan`
- `executeViaAlternateRoute`
- `handoffToRecoveryOwner`
- `pauseAndStabilize`

#### 共通の退避操作

- `holdDecisionItem`

下段の command は、選択中の `推奨アクション 1 / 代替案 2 / 代替案 3` に対して作用する。

操作後は、関連する `判断項目` または `実行要求` の状態変化を UI に即時再投影する。

## 巡回報告の表示仕様

区画巡回マップ上の吹き出しと役付きAI帯の短文は、会話ログではなく巡回報告として扱う。

表示ルール:

- 16〜28 文字程度
- 1〜2 行
- `現在処理 + 次の気がかり` を優先する
- 句点は 1 つまで
- 接続詞はできるだけ使わない
- 長文要約は即応パネルへ送る
- 人物クリックで会話開始にはしない

禁止するもの:

- 長い説明
- 結論のない独り言
- 感情表現の盛りすぎ
- 専門語の詰め込み

切り替えルール:

- 10〜15 秒ごと
- 全員同時更新しない
- 選択中の AI は更新を遅らせる
- 異常時は更新頻度を少し上げる

## 外部連携

v0 では外部ツールを正本にしない。

| ツール | v0 での役割 |
| --- | --- |
| Slack | 通知と軽い確認の窓口 |
| GitHub | 成果物参照 |
| Drive | 証跡参照 |
| Brainbase | 詳細作業面 |

判断に影響する内容は、必ず `UnsonOS` の `判断項目 / 成果物要求 / 上申資料 / 判断メモ` に戻す。

## 受け入れ条件

| AC | 内容 |
| --- | --- |
| AC1 | v0 導線に必要な object が 1 表で揃っている |
| AC2 | 各 UI 操作に command が対応している |
| AC3 | `証跡確認票 / 上申資料 / 判断メモ` の最小項目が決まっている |
| AC4 | transcript は保持されるが、主成果物にはしないことが仕様で固定されている |
| AC5 | 事業責任者までの終点が `判断待ち一覧` であることが仕様で固定されている |
