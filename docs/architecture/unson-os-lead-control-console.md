# アーキテクチャ: UnsonOS 現場責任者コンソール

## 文書メタ情報

- 状態: 有効
- 種別: アーキテクチャ
- 主題: 現場責任者コンソール
- 親文書: [現場責任者コンソールストーリー](../stories/unson-os-lead-control-console-story.md)
- 派生元: [UnsonOS UI コンセプト](./unson-os-ui-concept.md)
- 関連文書: [UnsonOS 現場責任者ランタイム構成](./unson-os-lead-runtime-architecture.md), [UnsonOS UI×制御面 整合性マトリクス](./unson-os-ui-architecture-alignment.md)
- 置換: なし

## 位置づけ

UnsonOS v0 の最初の主戦場は、経営者向けトップ画面ではなく **現場責任者が AI 作業者群を監督する現場責任者コンソール** として定義する。

- **Brainbase**: 作業台、セッション、ファイル、ターミナルを担う詳細作業面
- **現場責任者コンソール**: 施策、配分、進行、判断、稼働状況を担う管理面
- **UnsonOS**: Brainbase の上に、管理者、承認者、例外処理担当の視点を追加する

この文書では、現場責任者コンソールの責務境界と UI-to-domain 接続を定義する。  
API や component tree はまだ決めない。

各面がどの object / 投影 / command / policy に支えられるかは、[UI×制御面 整合性マトリクス](/Volumes/UNSON-DRIVE/brainbase-worktrees/session-1773022945038-brainbase/docs/architecture/unson-os-ui-architecture-alignment.md) を参照する。
押した時の反応と画面遷移は、[現場責任者コンソール UI遷移仕様](../specs/unson-os-lead-control-console-ui-spec.md) を正本とする。
command / event / record / policy / state transition の実装粒度は、[現場責任者 v0実装](../specs/unson-os-lead-v0-implementation-spec.md) を正本とする。

## 連絡の正本という前提

現場責任者コンソールは、会話の面ではなく **連絡の正本** を扱う面として設計する。

- Slack や Gmail は配信先・入力窓口として使う
- GitHub や Drive は成果物と証跡の正本として使う
- ただし、判断、上申、承認、差戻し、証跡要求は UnsonOS の連絡台帳と決定記録に戻す

現場責任者が見るべきものは、会話の山ではなく **裁ける単位の連絡 object** である。

詳細なランタイム境界と下層基盤との役割分担は、[`unson-os-lead-runtime-architecture.md`](/Volumes/UNSON-DRIVE/brainbase-worktrees/session-1773022945038-brainbase/docs/architecture/unson-os-lead-runtime-architecture.md) を参照する。

## 表ビューアという前提

現場責任者コンソールは、汎用表計算の代替ではなく **裁くための表ビューア** を持つ。

- 注力テーマ・施策一覧は、今週どの施策を進めるかを裁く表
- 判断待ち一覧は、今すぐ裁定が必要な項目だけを集める表
- 停滞一覧と証跡不足一覧は、どこへ介入するかを決める表

逆に、自由集計、大量セル編集、関数中心の加工は持たない。  
それらは Google Sheets や他ツールに残す。

## v0導線の正本

現場責任者コンソールの v0 は、次の 1 本を最初の正本導線として固定する。

**停滞中の施策を選ぶ -> 状況要約 -> 証跡確認 -> 成果物要求 or 再割り振り -> 上申資料 -> 判断記録**

この導線の運用型は [現場責任者 v0導線運用型ストーリー](../stories/unson-os-lead-workflow-validation-story.md)、
最小仕様は [現場責任者 v0導線運用型仕様](../specs/unson-os-lead-v0-operating-model-spec.md) を正本とする。

## なぜリードから始めるか

現場責任者は次の責務を同時に持つ。

- 何を今進めるか決める
- 配下の作業者群の 24/7 稼働を監督する
- 低リスクは流し、高リスクはゲートで止める
- 事業責任者へ上げる前の論点を整理する

今の Brainbase は作業台として強いが、上記を管理者視点で扱う面が弱い。  
したがって v0 は、Brainbase を捨てるのではなく **Brainbase の上に現場責任者面を足す** 形で進める。

## 体験設計の原則

現場責任者コンソールは、単に部品を並べた画面ではなく **忙しい管理職の頭の中をそのまま操作面にする** ことを目的にする。

この画面の基本分担は次で固定する。

- **左で、現場が生きている**
- **中央で、選んだ対象の進行を読む**
- **右で、人間が裁いている**
- **下で、今この場面に関係する役付きAIが前に出る**

左は AI 作業者群の 24/7 稼働と区画の空気を見せる面であり、中央は選んだ対象の進行と段階を読む面、右は判断待ちと即応介入を行う裁定面、下はその場面で関係の深い役付きAI帯である。

### 1. まず読むのではなく、まず裁ける

- 朝一で見るべきものは全文ログではなく `今日裁くべき項目`
- `判断待ち一覧`、`停滞一覧`、`証跡不足一覧` が先に目に入る

### 2. AI の 24/7 稼働は、気配ではなく異常の種類として見える

- 稼働状況パネルは、会話記録の洪水ではなく
  - 停滞
  - 承認待ち
  - 成果物不足
  - 実行失敗
  - 再試行
  の変化だけを返す

### 3. 軽い介入は短く終わる

- `即応パネル` は 1 つの対象に紐づき
- 原因
- 選択肢
- 次の操作
  だけを短く返す

### 4. 深い整理は例外であり、成果物化までが 1 セット

- `論点整理室` は毎案件開く面ではない
- 開いた場合は、上申資料や判断メモに変換して閉じる

### 5. 現場責任者の時間を詳細作業面へ逆流させない

- 詳細作業面は必要時だけ降りる
- 現場責任者の一日の大半が `作業台` で終わる状態は失敗とみなす

## 1 日の利用サイクル

### 朝の把握

- 区画ヘッダーで区画全体の変化を 3 秒で掴む
- `判断待ち一覧` と `稼働状況パネル` で今日裁くべき施策を絞る
- この時点では生ログを読まず、`今日の介入候補` と `昨日からの変化` だけを先に把握する

### 軽い介入

- 停滞中の施策を開く
- `即応パネル` で短い壁打ちを行う
- `再割り振り / 成果物要求 / 保留` をその場で実行する
- 再割り振りや成果物要求は、現場責任者が依頼文を都度書くのではなく、対象・期限・必要証跡を埋めた command として発行される

### 作業者への反映

- 配下の AI 作業者群や必要な人間作業者には、`対象 / 要求 / 期限 / 必要証跡 / 優先度` の形で指示が渡る
- 外部通知は飛んでよいが、正本は UnsonOS に残る
- 現場責任者は詳細作業面へ降りずに、作業の再起動と割り振りだけを裁ける

### 深い整理

- 迷う案件だけ `論点整理室` を開く
- 進める案 / 縮小案 / 停止案と反対意見を整理する
- `上申資料 / 判断メモ / 判断理由` を生成する
- 深い壁打ちは例外面であり、会話の出口は必ず `上申資料 / 判断メモ / 判断理由` のどれかに固定する

### 上申

- `論点整理室` の結果は、そのまま `判断待ち一覧` や上位 role の面に上がる
- 現場責任者は別のフォーマットへ書き直さなくてよい
- 上申対象には `候補案 / 推奨案 / 影響範囲 / 足りない証跡 / 現場責任者コメント` が含まれる
- v0 では、この上申が `事業責任者の判断待ち一覧` に載るところまでを導線の終点とする

### 夕方の締め

- 今日裁いた判断
- 今日出した成果物要求
- 今日変えた割り振り
- 残っている停滞
  を同じ区画画面で確認する
- 1 日の締めでは `何件作業したか` ではなく、`何件裁いたか / 何が明日に残るか` を確認する

## 体験成立条件

現場責任者コンソールは、見た目だけでは成立しない。最低限、次の条件を満たす必要がある。

### 1. 朝の圧縮表示が信用できること

- `稼働状況パネル` や `判断待ち一覧` の要約がズレると、現場責任者は結局 raw log に戻る
- したがって、朝の把握で使う要約は `変化量 / 停滞 / 承認待ち / 成果物不足 / 実行失敗` を優先し、飾りの情報を混ぜない

### 2. 即応パネルが長文チャット化しないこと

- 即応パネルは 1 対象に紐づく短い介入面である
- 返答は 3 行要約、原因、選択肢、必要承認、足りない成果物に圧縮する
- その場で `再割り振り / 成果物要求 / 保留 / 裁量昇格候補への判断` までつながることを優先する

### 3. 論点整理室が毎案件必要にならないこと

- 深い壁打ちは例外面である
- すべての案件で `論点整理室` を開くなら、現場責任者は再び作業者化する

### 4. 上申資料がそのまま使えること

- 現場責任者が作った `上申資料` を、事業責任者がそのまま裁ける必要がある
- ここで再整形や再説明が発生すると UX の価値が大きく落ちる

### 5. 詳細作業面に逆流しないこと

- 現場責任者の一日の大半が `作業台` で終わる状態は失敗とみなす
- `作業台` は必要なときの下り先であり、主画面の主語にしない

### 6. 外部ツールとの併用で正本が散らばらないこと

- Slack や会議は残ってよい
- ただし、判断に影響する内容は必ず対象 object に戻り、`判断待ち一覧 / 決定記録 / 上申資料` に反映される必要がある

## 中核画面モデル

現場責任者コンソールは次の 6 面で構成する。

1. 区画ヘッダー（`District Header`）
2. 注力テーマ・施策一覧（`Bet / Initiative Board`）
3. 進行レーン（`Flow Lane`）
4. 判断待ち一覧（`Decision Queue`）
5. 稼働状況パネル / イベントレール（`Live Ops Panel / Event Rail`）
6. 即応パネル（`Ops Dock`）
7. 連絡面（受信箱 / 稼働通知 / 決定記録）
8. 停滞一覧 / 証跡不足一覧
9. 裁量昇格候補一覧

補助面:

- 論点整理室（`Briefing Room`）
- 作業台（`Workbench Drawer`）
- `Artifact Drawer`
- `Run Trace Drawer`

## 区画巡回マップの反応規則

左側の `区画巡回マップ` は、会話を始める面ではなく、**範囲を切る / 担当を知る / すぐ裁く** ための面として扱う。

### 建物を押したとき

建物の主反応は **進行レーンを絞る** ことである。
建物は「どの実務面で見るか」を決める入口であり、まず対象施策の範囲を切る。

| 押した建物 | 主反応 | 即応パネルの初期タブ |
| --- | --- | --- |
| 実行棟 | `進行レーン` を実行段階の施策に絞る | `状況要約` |
| 検証棟 | `進行レーン` を検証段階の施策に絞る | `割り振り支援` |
| 証跡庫 | `成果物不足 / 証跡確認待ち` に絞る | `証跡確認` |
| 承認ゲート | `承認待ち / 差戻し中` に絞る | `リスク確認` |

建物を押しただけで `論点整理室` へ飛ばさない。
建物はあくまで「見る範囲」と「右側の初期文脈」を決める。

### AI を押したとき

AI の主反応は **担当カードを開く** ことである。
いきなり深掘りや壁打ちに入らず、まずその AI が何を見ているかを把握する。

担当カードに出す項目は次に固定する。

- 名前
- 職能
- 担当建物
- 今扱っている施策
- 裁量範囲
- 今の短文思考
- ここからできる操作

担当カードからの二次操作は次だけを許可する。

- `このAIの担当案件で絞る`
- `即応パネルでこのAIの見立てを先頭にする`

### 異常地点を押したとき

異常地点の主反応は **即応パネルを開く** ことである。
異常地点は「今すぐ裁くべき場所」なので、最短で右側の裁定面へ入れる。

異常地点から開く即応パネルの初期内容は次に固定する。

- 状況要約
- 原因候補
- 推奨アクション
- 即断ボタン

要するに、左のマップは次の 3 分類で扱う。

- 建物 = 見る範囲を切る
- AI = 誰が何を見ているかを知る
- 異常地点 = すぐ裁く

主ナビは常に `場所か異常` を先に選ぶ。
AI はその後で前に出る対象であり、人物選択を主ナビにしない。

## 役付きAI帯

下段の `役付きAI帯` は、固定名簿ではなく **今この区画で前に出る AI たち** を見せる帯として扱う。

### 通常時

常設するのは 4 体までに絞る。
優先順は次で固定する。

1. 今、持ち場で動いている
2. 停滞や承認待ちに関わっている
3. 現場責任者が直近で触った

### 展開時

`役付きAIをもっと見る` から一覧を開き、次の切り替えだけを持つ。

- 全員
- 今アクティブ
- 要注意案件を担当中
- 待機中

監視画面化を避けるため、通常時は「全員一覧」を常設しない。

## 即応パネルの構成

即応パネルは `要約面` ではなく **裁定卓** として扱う。
構成は 3 段で固定する。

### 上段: 状況

- 今の状態
- 主因
- 副因
- 全体リスク
- 関係AI

状態に応じて、次の補助項目を上段へ追加してよい。

- `成果物不足` の時: `必要証跡`
- `承認待ち` の時: `承認論点`, `必要証跡`
- `実行失敗 / 停滞中` の時: `影響範囲`

### 中段: 推奨アクション

- `推奨アクション 1`
- `代替案 2`
- `代替案 3`

各案には次を短く添える。

- 想定リスク
- 必要証跡
- 承認要否

### 下段: 即断ボタン

下段のボタンは固定ではなく、状態別に切り替える。

#### 成果物不足の時

- `成果物を要求`
- `期限を付ける`
- `代替証跡で進める`
- `再割り振り`
- `上申資料を作成`

#### 承認待ちの時

- `承認`
- `条件付き承認`
- `差戻し`
- `上申資料を作成`

#### 停滞中の時

- `再割り振り`
- `範囲を縮小して進める`
- `一時停止`
- `論点整理室へ送る`

#### 実行失敗の時

- `再実行`
- `別経路で実行`
- `回復担当に渡す`
- `停止して整理`

#### 共通の退避操作

- `保留`

ボタンは **選択中の案** に対して作用する。
つまり、現場責任者は `推奨アクション 1 / 代替案 2 / 代替案 3` のどれかを選んでから、下段の操作を打つ。

ボタンを押したら、状態がどう変わるかを即座に見せることを前提にする。

## 巡回報告の表示ルール

左マップ上の吹き出しや AI 帯の短文は、会話ログではなく **巡回報告** として扱う。

表示ルールは次で固定する。

- 16〜28 文字程度
- 1〜2 行
- `現在処理 + 次の気がかり` の文型にする
- 句点は 1 つまで
- 接続詞はできるだけ使わない
- 長文要約は右側へ逃がす
- 人物をクリックして会話開始にはしない

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

## 連絡 object の扱い

現場責任者コンソールでは、AI⇆AI、AI⇆人、人⇆人を同じ型の連絡 object で扱う。  
違うのは相手ではなく **連絡の目的** である。

### 主な目的

- 指示
- 報告
- 相談
- 判断依頼
- 承認依頼
- 証跡要求
- 差戻し
- 上申

### 現場責任者面で最低限見る項目

- 対象
- 発信者
- 宛先
- 目的
- 緊急度
- 期限
- 要求アクション
- 要約
- 参照証跡
- 配信先
- 結果

## 責務分解

### 1. ディストリクトヘッダー

**役割**

- 現場責任者が今どの区画を預かっているかを示す
- 状況の 3 秒把握を担う

**読むもの**

- 区画の目標
- throughput
- 停滞中件数
- 承認待ち件数
- リスク水準
- 実行キャパシティ
- 前回確認以降の変化

**投げる command**

- `focusDistrict`
- `openDistrictRisk`
- `openDistrictCapacity`

### 2. 注力テーマ・施策一覧

**役割**

- 現場責任者が今週進める施策を決める主会議面
- 注力テーマと施策の優先順位と状態を比較する

**読むもの**

- 施策一覧
- 現在段階
- 担当
- 期待効果
- 戦略価値
- 確信度
- 負荷
- ボトルネック要約
- 承認要否

**投げる command**

- `prioritizeInitiative`
- `holdInitiative`
- `greenlightInitiative`
- `assignLead`
- `watchInitiative`

**原則**

- ここは表形式を第一候補にする
- 1 行 = 1 つの判断対象
- チャットを埋め込まない
- 行を選んだら、即応パネルか論点整理室へつながる

### 3. フローレーン

**役割**

- `Story -> Scope -> Plan -> Execute -> Verify -> Approval -> Ship -> Learn`
  の進行線を slice 単位で見る
- blocked / pending / failed / done の現在地を示す

**読むもの**

- selected initiative に紐づく stories
- current checkpoint
- run state
- owner chain
- blocked cause summary
- waiting approval summary

**投げる command**

- `retryCheckpoint`
- `pauseExecution`
- `requestApproval`
- `rerouteRun`
- `openAuditPacket`

**原則**

- 1 つの lane は 1 つの initiative scope に紐づく
- raw transcript はここに混ぜない

### 4. 意思決定キュー

**役割**

- 今すぐ人間の裁定が必要な項目だけを集める
- 現場責任者の attention を一点に集約する

**読むもの**

- pending decision
- gate review result
- escalation candidate
- unresolved risk
- missing evidence summary

**投げる command**

- `approve`
- `reject`
- `requestEvidence`
- `promoteToGM`
- `deferDecision`

**原則**

- unread message 数は持たない
- queue item は decision object として扱う
- その場で承認、差戻し、上申、成果物要求へつながる
- 同種判断が繰り返されている場合は、`裁量昇格候補` を判断対象として扱える

### 4.5 停滞一覧 / 証跡不足一覧

**役割**

- 停滞中の施策と証跡不足の施策を横断で集める
- どこから裁くかの優先順位をつける

**読むもの**

- 対象施策
- 停滞時間
- 主な停滞理由
- 不足証跡
- 影響範囲
- 次の必要判断

**投げる command**

- `openBlockedInitiative`
- `requestEvidence`
- `rerouteWork`
- `promoteToGM`

**原則**

- ここも見るためではなく裁くための表として扱う
- 稼働状況パネルの異常を、介入可能な行に変換する

### 4.6 裁量昇格候補一覧

**役割**

- 毎回同じ確認をしている箇所を、次回からの事前許可候補として裁く
- AI が自分の権限を自己拡張するのではなく、人間が条件付きで昇格させる

**読むもの**

- 対象操作
- 適用範囲
- 前提条件
- 必要証跡
- 例外条件
- 有効期限
- 見直し条件
- 同種承認回数
- 差戻し / 事故の有無
- 推奨理由

**投げる command**

- `approveDiscretionCandidate`
- `narrowDiscretionCandidate`
- `keepAskFirst`
- `escalateDiscretionCandidate`

**原則**

- `次回から聞かなくてよいか` という自由文確認ではなく、**条件付きの事前許可候補** として扱う
- AI は昇格候補を作ってよいが、権限の自己承認はできない
- 昇格後も `有効期限` と `見直し条件` を持ち、失敗時はロールバックできる

### 5. 稼働状況パネル・イベントレール

**役割**

- 作業者群の 24/7 activity を認知可能な密度で見せる
- transcript ではなく、`state` と `delta` を表示する

**読むもの**

- 稼働中チェーン数
- 停滞増減
- 承認待ち hotspot
- 再試行の活動
- 遊休 / 過負荷の cluster
- 直近の状態変化
- 裁量昇格候補の発生数

**投げる command**

- `focusHotspot`
- `openBlockedSlice`
- `addToWatch`
- `openOpsDock`

**原則**

- 生ログの ticker にしない
- 変化だけを一行イベントで出す
- 作業者 1 体ではなく chain / district health を出す
- AI⇆AI の連携は chat ではなく trace として圧縮表示する
- 現場責任者にとっては「現場の空気」ではなく「介入すべき異常の種類」が先に分かることを優先する

### 6. 即応パネル

**役割**

- 選択中 object に対する短い介入対話を担う
- チャットではなく即応用の介入パネルとして機能する
- 現場責任者にとっての `即応壁打ち` を担う

**読むもの**

- 選択中 object の文脈
- 現在段階
- 停滞 / リスク / 証跡の要約
- 直近の判断
- ポリシー / 境界の要約

**入力**

- intent chips
  - `Brief`
  - `Diagnose`
  - `Direct`
  - `Review`
  - `Evidence`
  - `Prepare`
- 必要時のみ自由入力

**返すもの**

- `Summary Card`
- `Options Card`
- `Gate Review Card`
- `Evidence Gap Card`
- `Escalation Packet Card`
- `Discretion Candidate Card`

**体験上の役割**

- 即応壁打ちを 1 分以内で終わらせる
- 会話のための会話ではなく、その場の裁定に直結させる
- ここで解ける案件は `論点整理室` に持ち込まない
- `Decision Record Card`

**投げる command**

- `applyReroute`
- `changePriority`
- `requestArtifact`
- `openApprovalPacket`
- `escalateToGM`
- `logRationale`
- `createDecisionRecord`
- `approveDiscretionCandidate`
- `narrowDiscretionCandidate`
- `keepAskFirst`

**原則**

- 空のチャットから始めない
- 1 object 1 scope を守る
- 返答の終点は action か decision-support object にする
- transcript をそのまま残さず、判断メモ、上申資料、判断理由へ変換する
- AI が `次回から聞かなくてよいか` と雑に確認するのではなく、`Discretion Candidate Card` として条件付きの昇格候補を出す

**使いどころ**

- `何が詰まってる？`
- `この initiative の bottleneck は？`
- `reroute 案を 3 つ出して`
- `approval risk だけ見て`
- `事業責任者に上げるなら論点を整理して`
- `この再割り振りを、次回から事前許可候補にして`

## ブリーフィングルーム

### 役割

論点整理室（`Briefing Room`）は、現場責任者が表や一覧だけでは詰め切れない論点を整理するための **管理者向け論点整理面** である。  
作業者の作業台ではない。  
現場責任者にとっての `深掘り壁打ち` は、この論点整理室が担う。

### 開始契約

論点整理室は次の面からのみ開く。

- `Decision Queue`
- `Flow`
- `Audit`

開始時には必ず以下を preload する。

- district / initiative
- current stage
- blocked / risk / evidence 状況
- current allocation
- recent decision history

### 内部構成

#### Left: Context Rail

- district objective
- selected initiative
- current stage
- blocked reasons
- current allocation
- linked evidence
- recent decisions

#### Center: Deliberation Thread

- intent-scoped で開始する
- primary intents:
  - `Explore`
  - `Diagnose`
  - `Reroute`
  - `Review Risk`
  - `Check Evidence`
  - `Prepare GM Brief`
- freeform は secondary に置く

#### Right: Outcome Rail

- `Hypotheses`
- `Risks`
- `Open Questions`
- `Candidate Actions`
- `Escalation Points`
- `Linked Evidence`
- `Draft Decision Memo`

### 出力ルール

論点整理室の主成果物は transcript ではなく、次の object にする。

- `Decision Queue item`
- `GM Brief`
- `Rationale log`
- `Evidence request`
- `Reroute proposal`
- `Discretion policy proposal`

### 体験上の役割

- 現場責任者が深く考えること自体を無駄にしない
- 上申のために別フォーマットへ書き直す作業を減らす
- 深掘りの出口を `上申資料 / 判断メモ / 判断理由` に固定する

### アンチパターン

- 主画面中央の巨大チャット欄
- 4 つの role AI と別々に会話する frontstage
- transcript を主成果物として残すこと

## ワークベンチドロワー

### 役割

Brainbase の既存資産を活かした作業面。  
必要時のみ、現場責任者が raw context を見に行く場所。
raw session / chat は主画面ではなく、この詳細 / Brainbase 側に置く。
ただし transcript 自体は捨てず、事後検証、説明責任、障害解析のための下層記録として保持する。

### 範囲

- session
- terminal
- files
- raw log
- tool trace
- artifact detail

### Principle

- main surface に逆流させない
- 現場責任者の一日のデフォルト画面にしない
- 作業台を開く前に、一覧 / 進行 / 即応パネル / 論点整理室で裁けるようにする

## 管理者向け AI 境界

現場責任者に見せる AI は、背後の作業者群を圧縮した manager-facing 窓口である。

- `Floor Manager`
- `Dispatcher`
- `Gatekeeper`
- `Archivist`

ただし frontstage の主語は role ではなく `intent` とする。  
role は card attribution に留め、現場責任者に「誰に聞くか」を管理させない。

## 状態モデル

現場責任者コンソールが主に扱う状態は次の 5 種。

- `initiative state`
- `allocation state`
- `decision state`
- `flow state`
- `live ops state`

これらはすべて projection として読み、command を通して変更する。

## 遷移契約

### 基本導線

1. 現場責任者が `District Header` で区画を確認
2. `Bet / Initiative Board` で施策を選ぶ
3. `Flow Lane` で現在の checkpoint と詰まりを見る
4. `Decision Queue` で人間判断が必要な項目を裁く
5. 軽い介入は `Contextual Ops Dock`
6. 深い論点整理は `Briefing Room`
7. 必要時だけ `Workbench Drawer`

### Object-Preserving Drill-Down

- `Board row`
  → 同 initiative の `Flow slice`
- `Flow blocked checkpoint`
  → `Ops Dock` または `Audit packet`
- `Decision Queue item`
  → `Briefing Room`
- `Audit packet`
  → `Briefing Room` or `Workbench Drawer`

常に object を維持したまま縮尺だけ変える。

## 移行方針

v0 では Brainbase を全面置換しない。

- 先に現場責任者コンソールを追加する
- 既存の session / terminal / file は `Workbench Drawer` に寄せる
- 作業者の主戦場は当面 Brainbase 側に残してよい
- 現場責任者が manager として振る舞えることを先に成立させる

## 依存関係

- [`unson-os-lead-control-console-story.md`](/Volumes/UNSON-DRIVE/brainbase-worktrees/session-1773022945038-brainbase/docs/stories/unson-os-lead-control-console-story.md)
- [`unson-os-ui-concept.md`](/Volumes/UNSON-DRIVE/brainbase-worktrees/session-1773022945038-brainbase/docs/architecture/unson-os-ui-concept.md)
- [`unson-os-terminology.md`](/Volumes/UNSON-DRIVE/brainbase-worktrees/session-1773022945038-brainbase/docs/architecture/unson-os-terminology.md)
- 既存 Brainbase workbench
