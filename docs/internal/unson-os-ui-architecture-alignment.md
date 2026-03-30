# アーキテクチャ: UnsonOS UI×制御面 整合性マトリクス

## 文書メタ情報

- 状態: 有効
- 種別: アーキテクチャ
- 主題: UI×制御面 整合性
- 親文書: [UnsonOS UI コンセプト](./unson-os-ui-concept.md)
- 派生元: [UnsonOS 現場責任者ランタイム構成](./unson-os-lead-runtime-architecture.md)
- 関連文書: [UnsonOS ズーム契約](./unson-os-zoom-contract.md), [UnsonOS 現場責任者コンソール](./unson-os-lead-control-console.md)
- 置換: なし

## 位置づけ

この文書は、`UI コンセプト` と `現場責任者ランタイム構成` の間にある **整合性契約** を固定するための文書である。  
目的は、画面ごとの見え方と、その裏にある object / 投影 / command / policy / 正本更新の関係を一枚で揃えることにある。

この文書でいう UI は、正本を持たない **投影面** である。  
UI は command を発行し、`UnsonOS` 制御面が policy と正準ドメインを通じて正本を更新し、その結果が再び UI に投影される。

v0 で最初に通す導線は [現場責任者 v0導線運用型ストーリー](./unson-os-lead-workflow-validation-story.md) と [現場責任者 v0導線運用型仕様](./unson-os-lead-v0-operating-model-spec.md) を正本とする。

## この文書で固定すること

### 1. 同じ対象を違う高度で見る

経営者、事業責任者、現場責任者は別の世界を見ているのではない。  
同じ `事業 / 区画 / 施策 / 判断項目 / 決定記録 / 証跡` を、違う縮尺と違う主操作で見ている。

### 2. UI は queue や runtime を直接触らない

UI が行うのは次の 2 つだけである。

- object を選ぶ
- command を発行する

`実行要求キュー` への投入、claim、runtime 連携は、`UnsonOS` 制御面が担う。

### 3. Brainbase は詳細閲覧面であり、保存の正本ではない

`Brainbase` は

- raw session
- 生ログ
- terminal
- files
- trace range

を読むための詳細作業面である。  
作業痕跡の正本は `UnsonOS` の作業痕跡保管と下層 runtime / 外部成果物側で持つ。

### 4. 画面名と backend 責務名を分ける

画面上では

- 即応パネル
- 論点整理室
- 判断待ち一覧

のような名前を使ってよい。  
ただし backend 側では

- 対話支援サービス
- 判断資料生成サービス
- 役割別投影生成器

のように、UI 非依存の責務名で扱う。

### 5. 経営判断面を支える専用投影を持つ

`ミッション層` は世界観の添え物ではなく、経営判断の本体である。
したがって、

- 注力テーマ・施策一覧
- 優先順位・配分表
- 判断待ち一覧

を返す専用の投影生成器を明示的に持つ。
`進行` の投影を流用して経営判断面を作る前提にはしない。

### 6. 状態は UI 面ごとに違う軸を読む

単一の圧縮状態で全 UI 面を支えない。
全体俯瞰面、経営判断面、進行管理面、監査面、詳細作業面は、それぞれ必要な状態軸だけを読む。

### 7. 同じ object を role ごとに違う高度で見る

経営者、事業責任者、現場責任者は、別々の object を見ているのではない。
同じ `事業 / 区画 / 施策 / 判断項目 / 決定記録 / 証跡` を、違う縮尺・違う既定ソート・違う主操作で見ている。

この前提を崩すと、世界観の統一ではなく、別 UI の寄せ集めになる。

## UI×制御面 整合性マトリクス

| UI 面 | UI コンポーネント | 表示する object | 必要な集約器 / 投影生成器 | 発行する command | 通る policy | 更新される正本 | drill-down 先 | 外部連携 | 役割 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 全体俯瞰面 | 事業都市一覧 | 事業、注意度、上申状態、承認状態、配分状態 | 事業俯瞰投影生成器 | `focusBusiness`, `setPortfolioLens` | 閲覧権限 policy | なし | 経営判断面 | なし | 経営者 |
| 経営判断面 | 注力テーマ・施策一覧 | 施策、注力テーマ、進行段階、注意度、期待効果 | ミッション投影生成器 | `prioritizeInitiative`, `holdInitiative`, `greenlightInitiative` | 配分変更 policy、権限 policy | 施策、配分、判断項目 | 進行管理面、論点整理室 | GitHub 参照、Drive 参照 | 経営者、事業責任者、現場責任者 |
| 経営判断面 | 優先順位・配分表 | 配分、施策、事業、能力枠、期限、停滞閾値 | 配分投影生成器、配分変換器 | `reallocateCapacity`, `changePriorityBand`, `changeEscalationThreshold` | 配分変更 policy、運転ルール policy | 配分、ポリシー版 | 進行管理面 | Calendar 参照、GitHub 参照 | 経営者、事業責任者 |
| 経営判断面 | 判断待ち一覧 | 判断項目、承認状態、上申状態、証跡状態、注意度、裁量昇格候補 | 判断キュー集約器、裁量候補投影生成器 | `approveDecisionItem`, `approveDecisionItemWithConstraint`, `returnDecisionItem`, `createEscalationPacket`, `approveDiscretionCandidate`, `narrowDiscretionCandidate`, `keepAskFirst` | 承認 policy、証跡必須 policy、上申 policy、裁量昇格 policy | 判断項目、決定記録、連絡項目、ポリシー版 | 監査面、論点整理室、詳細作業面 | Slack 配信、Gmail 配信 | 経営者、事業責任者、現場責任者 |
| 進行管理面 | 進行レーン | 施策、進行段階、実行健全性、証跡状態、承認状態 | 施策状態集約器、進行投影生成器 | `rerouteExecution`, `pauseAndStabilize`, `retryExecutionPlan`, `requestArtifact` | 段階遷移ゲート、例外ゲート、証跡必須 policy | 実行要求、判断項目、連絡項目 | 即応パネル、論点整理室、詳細作業面 | GitHub 参照、Drive 参照 | 事業責任者、現場責任者 |
| 進行管理面 | 稼働状況パネル | 実行要求、実行健全性、停滞 cluster、異常 cluster、裁量昇格候補数 | 稼働状況集約器、注意度投影生成器、裁量候補投影生成器 | `focusExecutionIssue`, `requestRuntimeRecovery` | runtime 障害 policy、停滞閾値 policy | 判断項目、連絡項目 | 判断待ち一覧、詳細作業面 | Slack 通知参照 | 事業責任者、現場責任者 |
| 進行管理面 | 停滞一覧 / 証跡不足一覧 | 施策、実行要求、証跡状態、注意度、期限 | 停滞投影生成器、証跡不足投影生成器 | `requestArtifact`, `rerouteExecution`, `createEscalationPacket` | 証跡必須 policy、上申 policy | 連絡項目、判断項目、決定記録 | 即応パネル、論点整理室 | Drive 参照、Notion 参照 | 事業責任者、現場責任者 |
| 進行管理面 | 即応パネル | 対象 object の要約、原因 cluster、選択肢、必要承認、証跡不足、裁量昇格候補 | 対話支援サービス、役割別投影生成器、裁量候補生成器 | `askForBrief`, `askForEvidenceReview`, `requestArtifact`, `setArtifactDueDate`, `proceedWithAlternativeEvidence`, `rerouteExecution`, `shrinkScopeAndContinue`, `approveDecisionItem`, `approveDecisionItemWithConstraint`, `returnDecisionItem`, `retryExecutionPlan`, `executeViaAlternateRoute`, `handoffToRecoveryOwner`, `pauseAndStabilize`, `sendToBriefingRoom`, `createEscalationPacket`, `holdDecisionItem`, `approveDiscretionCandidate`, `narrowDiscretionCandidate`, `keepAskFirst` | 閲覧権限 policy、対話支援 policy、裁量昇格 policy | なし。必要時のみ判断項目 / 連絡項目 / ポリシー版生成 | 論点整理室、詳細作業面 | なし | 事業責任者、現場責任者 |
| 監査面 | 監査パケット / 証跡一覧 | 決定記録、証跡、成果物参照、作業痕跡参照、承認履歴 | 監査投影生成器、決定記録投影生成器 | `openTraceRange`, `requestSupplementalEvidence`, `reopenDecisionItem` | 監査閲覧 policy、再開示 policy | 判断項目、連絡項目 | 詳細作業面、論点整理室 | Drive 参照、GitHub 参照、Notion 参照 | 経営者、事業責任者、現場責任者 |
| 連絡面 | 受信箱 / 稼働通知 / 決定記録 | 連絡項目、判断項目、決定記録、裁量昇格候補 | 連絡投影生成器、決定記録投影生成器、裁量候補投影生成器 | `ackCommunication`, `openDecisionItem`, `openEscalationPacket`, `openDiscretionCandidate` | 緊急度 policy、通知 policy、裁量昇格 policy | 連絡項目、決定記録、ポリシー版 | 即応パネル、論点整理室、監査面 | Slack、Gmail、Calendar | 全役割 |
| 連絡面 | 論点整理室 | 施策、判断項目、決定記録、証跡、作業痕跡参照 | 判断資料生成サービス、対話支援サービス | `createEscalationPacket`, `recordDecision`, `holdDecisionItem` | 上申 policy、判断記録 policy | 決定記録、判断項目、連絡項目 | 監査面、詳細作業面 | Drive 参照、Notion 参照 | 事業責任者、現場責任者 |
| 詳細作業面 | Brainbase 作業台 | raw session、作業痕跡、files、terminal、tool trace | 詳細投影生成器、作業痕跡参照器 | `openSession`, `openTrace`, `openFile` | 詳細閲覧 policy、痕跡閲覧 policy | なし。参照のみ | raw trace / files / terminal | GitHub、Drive、ローカル files | 作業者、現場責任者 |

## 経営判断面を支える投影

経営判断面は `進行管理面の副産物` ではない。
少なくとも次の読み取り object を専用に組み立てる。

| 投影 | 主な列 |
| --- | --- |
| 注力テーマ・施策一覧 | 施策、注力テーマ、期待効果、進行段階、注意度、直近判断 |
| 優先順位・配分表 | 施策、配分帯、能力枠、期限、停滞閾値、見直し時刻 |
| 判断待ち一覧 | 判断項目、承認状態、証跡状態、上申状態、裁量昇格候補、期限 |

これらは `ミッション投影生成器` と `配分投影生成器` が返し、現場責任者面・事業責任者面・経営者面で粒度だけを変えて使う。

## UI 操作と command の流れ

### 基本原則

UI の操作は、必ず次の順に流れる。

1. UI が command を発行する
2. 制御面が command を受ける
3. policy と権限を評価する
4. 正準ドメインを更新する
5. 必要なら `実行要求キュー` を更新する
6. 投影生成器が UI を再描画する

### 例: 再割り振り

1. 現場責任者が `進行レーン` で `再割り振り` を押す
2. UI は `rerouteExecution` command を発行する
3. 制御面が
   - 権限 policy
   - 実行健全性
   - 承認状態
   - 証跡状態
   を確認する
4. `実行要求` と `配分` を更新する
5. `実行要求キュー` が再構成される
6. `稼働状況集約器` と `施策状態集約器` が UI を更新する

## 状態軸と UI 面の対応

圧縮状態を一つの enum として扱わない。  
各面は次の状態軸から必要なものだけを読む。

| UI 面 | 必須の状態軸 |
| --- | --- |
| 全体俯瞰面 | 注意度、上申状態、承認状態 |
| 経営判断面 | 進行段階、承認状態、証跡状態、注意度 |
| 進行管理面 | 進行段階、実行健全性、承認状態、証跡状態、上申状態 |
| 監査面 | 承認状態、証跡状態、決定履歴 |
| 詳細作業面 | 作業痕跡、trace range、実行健全性 |

## 役割別ズーム契約

同じ object に対して、役割ごとに既定の縮尺と主操作だけが変わる。

| 役割 | 既定の縮尺 | 主に見る面 | 主操作 |
| --- | --- | --- | --- |
| 経営者 | 事業群 → 事業 | 全体俯瞰面、経営判断面 | 配分変更、継続判断、停止判断、上位判断 |
| 事業責任者 | 事業 → 区画 | 経営判断面、進行管理面、監査面 | 再優先順位付け、承認、上申整理、配分変更 |
| 現場責任者 | 区画 → 進行 / 監査 | 進行管理面、連絡面、監査面 | 再割り振り、成果物要求、上申、ゲート判断 |
| 作業者 | 詳細 object | 詳細作業面 | 実作業、成果物返却 |

## runtime と UI の境界

### runtime 側の責務

- 実行要求の claim
- worker 起動
- heartbeat 回収
- trace 回収
- 実行完了 / 失敗 / 停滞の返却

### UnsonOS 制御面の責務

- command 受理
- policy 判定
- 正準ドメイン更新
- 判断項目 / 連絡項目 / 決定記録生成
- ミッション投影 / 進行投影 / 監査投影の生成
- UI 投影生成

### UI 側の責務

- object を選ぶ
- command を発行する
- 判断資料と投影を読む
- drill-down で詳細へ降りる

## Brainbase との整合

`Brainbase` は保存先の主役ではない。  
`Brainbase` は次を読むための詳細作業面である。

- raw session
- 生ログ
- terminal
- files
- trace range

そのため、`作業痕跡保管庫` と `外部の成果物実体` は `UnsonOS` / runtime / 外部ツール側に残し、`Brainbase` は参照面としてのみ扱う。

## 次にレビューすべきズレ

1. 経営判断面を支える専用の投影生成器が不足していないか
2. UI 操作ごとに command / policy / 正本更新が一意に結べているか
3. UI から queue を直接触る誤読が図に残っていないか
4. Brainbase が保存先と閲覧面で混ざっていないか
5. 経営者 / 事業責任者 / 現場責任者のズーム契約が崩れていないか
6. UI 名が backend の core service 名に逆流していないか
7. 各 UI 面が必要とする状態軸を backend が返せているか
8. 経営判断面を支える専用投影が runtime 側で実在しているか
