# 自律型AI社員構想 — ノードアーキテクチャと段階進化（骨子）

**Status**: Draft（骨子）
**Author**: 佐藤
**Date**: 2026-07-24
**Audience**: 佐藤自身の見返し用 + 構想を人に伝えるための資料の骨格

---

## 0. 一言サマリ

> 今作るのはmanaの代替ではなく、UnsonOSとMeshで無数に複製される「ノード」の第1号機。
> 体（OpenRyoko）は薄く借り、契約と台帳と知識層にだけ投資し、Lightsailに正本を作らない。

- AI社員 = 「顔（チャネル）/ 体（常駐gateway）/ 脳（知識層）/ 脳幹（統制層）」からなる**ノード**
- このノード設計図が、現在（1体）→ UnsonOS（組織）→ Mesh（各人1ノードの網）へと**同じ形で反復**される

---

## 1. 問題意識（なぜやるか）

- **社長の脳が唯一の全体像統合ポイント = ボトルネック**（`docs/frames/mesh-ai-driven-management.md`）。
  目標状態は「社長は例外承認のみ」（SSOT原理E: 自律運転への収束）
- **manaの構造的限界**:
  - Lambda（クラウド）はローカル資産（Graph SSOTトンネル・31013制御面・worktree）に触れない
  - デプロイ摩擦（手動deploy.sh）、EventBridge全DISABLED
  - 「Slackに住んで空気を読む常駐マネージャー」構想が受動応答止まりで未実装
- **2026年の業界環境の変化**: AnthropicのサードパーティOAuth制限（1月）+ API従量での自律運用制限（4-6月）により、
  自前agent runtime + API課金型（OpenClaw型）が持続不能に。公式CLIラップ+サブスク型へ潮流が転換

---

## 2. 世の中の実例と教訓（2026年時点）

### 2.1 系譜マップ

```
OpenClaw（自前brain・API課金・100k+ stars）
   │  ← Anthropic規約/課金の変化で持続不能に
   ▼
Jinn（「Bus, not brain」= 知能を公式CLIに委譲、gatewayは運搬だけ）
   │  ← 日本向けfork（コード約95%共通）
   ▼
OpenRyoko（泉水亮介氏 / TEKION。「Slackに住むAI同僚」= Triage・Canvas同期・日本語化）

並走: Hermes Agent（Nous Research、スキル自己作成・cron第一級）
     Sierra（Bret Taylor、「企業に1人格」+ 裏でスーパーバイザーが専門agent群にdispatch）
```

### 2.2 業界で収斂しつつあるパターン

1. Gateway常駐 + チャットアプリがUI（既存メッセンジャーがAI社員の顔）
2. 人間が読めるMarkdown/SQLiteメモリ + 検索（MEMORY.md + daily notes + compaction前保存フック）
3. heartbeat（何もなければ`HEARTBEAT_OK`で沈黙する契約）+ cron + イベント駆動のハイブリッド
4. SKILL.md形式のスキルが事実上の標準
5. HITLは「不可逆操作の直前ゲート」に収斂（送信前承認・PRレビュー・決済確認）
6. サンドボックス階層化・prompt injection前提の封じ込め

### 2.3 OpenClawの失敗から学ぶこと（反面教師）

- 公開インスタンス4万件超のうち35〜63%が脆弱（CVE-2026-25253ほか）
- スキル市場ClawHubに悪意スキル1,184件超（サプライチェーン汚染、スキルの36%にprompt injection）
- 教訓: **能力より封じ込め**。非公開バインド・スキルはPRレビュー配布・外部コンテンツ読取セッションの権限降格

---

## 3. 設計憲法（基本原理）

### 3.1 ノードの解剖図（全フェーズ共通の不変構造）

```
[顔]   チャネル（Slack / 将来はMesh peer）
[体]   常駐gateway + エンジンspawn（OpenRyoko → 交換可能）
[脳]   知識層（Graph SSOT / 個人KG / MEMORY.md + skills）
[脳幹] 統制層（台帳・承認・自律度・Decision KPI）← Brainbase Core
```

### 3.2 資産と使い捨ての分離

- **世代を超えて生き残る資産（ここに投資）**:
  `external_runner.v0` 契約 / Run Receipt・Automation Run台帳 / 自律度4段階 + Decision Events KPI /
  Graph SSOT・Personal KG・candidate-store昇格ゲート / mesh_queryプロトコル
- **使い捨て・交換可能（深追いしない）**:
  OpenRyoko fork（gateway部分のみ薄く借用）/ Lightsailインスタンス / mana Lambda（フォールバック後に縮退）

### 3.3 入り口とワーカーの独立スケーリング

> 入り口（人格）の数は認知の都合、ワーカーの数は処理の都合で決め、両者を独立にスケールさせる。
> 人格の追加は「責任の一意化」が要求する場合に限る。

- 複数入り口 = ルーティング判断コストの人間への押し付け（設計違反）。ルーティングは機械の仕事
- 人格を分けてよいのは: 対外ブランド・契約主体が違う（unson/ST/TK）、責任・エスカレーション先が違う（CEO/GM/Lead）
- Slack上の表現: bot識別子1つ（表の人格）/ チャンネル=文脈ルーティングキー / メンバーシップ=権限マスク /
  スレッド署名・Canvas=裏ワーカーの透明化

### 3.4 正本配置ポリシー（Distribution Modelの拡張）

判定は一問:「このファイルは他のノード（他メンバーのPC）にもあるべきか？」

| 置き場所 | 何を置くか |
|---|---|
| GitHub (repo) | 履歴管理・配布が必要な「動作」「コンテンツ」: skills、社員定義YAML、ノード設定、docs |
| Graph SSOT (PG) | 「事実」: エンティティ・意思決定・自律度の現在値・ノードidentity |
| Drive | バイナリ・共同編集アセット |
| ノードローカル（Lightsail等） | **runtime状態のみ**: var/、セッションworkspace、MEMORY.md実体。**正本を作らない** |

### 3.5 委任境界は計測で広げる（Brainbase独自の優位）

- 自律度4段階: `human_only` → `draft_only` → `approval_required` → `auto_execute`
- Decision Events（8種: surfaced / ai_drafted / draft_accepted / draft_edited / self_handled / escalated / ignored / rule_created）で
  委任率・差戻し率を週次計測
- 差戻し率が閾値を下回ったタスク種だけ昇格（`rule_created`として記録）。high-riskターゲット
  （external_message_draft / graph_ssot_decision 等）は昇格対象外に固定
- → 「AI社員の裁量権限を人事評価のように定量管理する」。世のOSS実装（OpenClaw/Jinn等）はどれも持っていない

### 3.6 Mac Companionとの整合

SlackとCompanionは競合しない。**情報の流れる方向が逆**であり、ADR-017の分業にそのまま載る。

| | Slack（@mana） | Mac Companion |
|---|---|---|
| 方向 | 人間 → AI（話しかける・依頼・会話） | 統制面 → 人間（承認・修正が必要な項目のみpush投影） |
| 性質 | 対話チャネル（入り口） | 割り込み面（注意のインボックス） |
| 対象者 | 全員 | 佐藤（管理者）のみ |
| ADR-017責務 | —（チャネル層） | notify / focus / approve / correct / feedback |

「入り口は1つ」原則（§3.3）は**対話の入り口**の話であり、Companionは入り口ではなく投影面なので抵触しない。
非対称設計（§5）の「佐藤側にだけ増える承認面」の実体がCompanionである。

**守るべき整合条件3つ**:

1. **承認の正本は1つ（human_step）**: CompanionのApproval InboxもSlack承認リアクションも、
   同じstep IDを冪等にresolveする「別入力面」として実装する
   （`/api/workflow-runs/:runId/human-steps/:stepId/resolve`）。OpenRyoko側に独自の承認状態を持たせない
2. **通知の重複制御**: 同じ承認依頼をSlackとCompanionの両方に鳴らさない。
   優先度で配送先を分ける（high-riskターゲット保護対象=Companion、通常ドラフト承認=Slackスレッド）
3. **Slack経路でもDecision Eventsを発行**: 判断委任KPIは現状Companion経由で計測される設計のため、
   Slackリアクション承認が主経路になるとKPIが過小計測される。OpenRyoko gatewayからも
   `draft_accepted` / `draft_edited` / `escalated` 等を同じDecision Events APIへ送る配線を
   Phase 1の接続要件に含める

長期（Phase 3）では佐藤の個人ノードとの対話がCompanionの一部機能を吸収しうるが、
OSレベルの割り込み・break-glass・強い認証での高リスク承認はCompanion固有の価値として残る。

**Companionは例外専用**: Companionに出てよいのは「委任境界の変更（昇格審査）と例外
（blocked・繰り返し無視の集約シグナル・high-risk接触）」のみ。定常業務の個別承認が恒常的に
流れ続けるのはアンチパターン（社長ボトルネックの再生産）。`draft_only` 期間の承認は内容の門番
ではなく**昇格の証拠集め（委任の校正装置）**であり、試用期間として期限を持つ。

### 3.7 三つの行動モードと二体のランナー

**ランナーは2体**。`external_runner.v0` は特定ランナー専用の契約ではなく、複数ランナーが同じ形式で
台帳へ実行結果を返すための共通契約である。

```
                Brainbase Control Plane（台帳・承認・自律度・KPI）
                     │ LoopIntent dispatch        ↑ external_runner.v0 ingest
        ┌────────────┴────────────┐               │（両ランナーがここへ報告）
        ▼                         ▼               │
  Cloudflare/computer runtime       OpenRyoko（Lightsail）──┘
  browser/computer/tool実行          Slack gateway + Triage + PTYエンジン
  外部runtime状態を所有               会話・人格・チャネル層
```

ノードの行動は3モードに分かれ、モードごとに担当ランナーと台帳の扱いが決まる:

| モード | 何か | 担当 | 台帳 |
|---|---|---|---|
| **会話** | 話しかけへの応答、Triage発の自発コメント・リアクション | **OpenRyoko**（gateway内で即時。dispatchの往復なし） | 意味のある判断のみDecision Events。全発言のReceipt化はしない |
| **反射** | heartbeat起床、Canvas描画、ヘルスチェック、セッションGC | 各ランナーのインフラ機構 | 載せない（ヘルスログ程度） |
| **業務ループ** | learn daily、リマインド、議事録→Graph反映、mana M系等の登録された仕事 | **原則Cloudflare/computer**（schedule/LoopIntent→dispatch）。一部Ryokoエンジン | Run Receipt必須、Decision Events発行、スケジュール定義の正本はagent-control-catalog |

**ガバナンスは起動経路ではなく行為の効果に付く（入口で縛らず出口で縛る）**:

- 社内チャンネルでのコメント・リアクション = 低リスク行為。会話モードの裁量内で即時実行できる
  （Ryokoの社交的な自律性を殺さない）
- 外部送信・Graph書込・タスク起票 = 効果のある行為。会話の流れ中でも同じhuman_step/自律度ゲートを通る

**業務ループ判定チェックリスト**（1つでもYESなら業務ループとして登録する）:

1. 外部への書き込み・送信が定常的な目的か（Slack投稿・Graph書込・メール）
2. 将来 `auto_execute` へ昇格させたいと言う可能性があるか（自律度の概念が意味を持つか）
3. 失敗・滞留を佐藤が知りたいか
4. 委任率KPIの分母に入るべき仕事か

→ 直感形:「これはAI社員の**仕事**か、**心臓の鼓動**か」。仕事を台帳外のcronで回すと
台帳にもKPIにも載らない**闇業務**になり、委任率の過小計測と監査抜けを生む（最も避けたい事故）。

**ランナー間の振り分け判定軸**（業務ループをどちらで回すか）:

1. **経済性**: Cloudflare/computerとRyokoの実測コストを比較し、大量・長時間ループはコスト構造で選ぶ
2. **接地性**: Slackスレッド文脈・Lightsailローカル状態に濃く触る仕事はRyoko。
   headlessでAPI越しに完結する仕事（議事録reconcile等）はCloudflare/computer
3. **信頼性**: 落ちてはいけない定期業務は、実行証跡と再試行を持つCloudflare/computer。Ryokoは自前運用で障害対応は自分持ち

境界ケース:「会話から派生した重い仕事」（「調べときます」の裏作業）は、RyokoがLoopIntentを
起票してCloudflare/computerへ投げるのが基本形。Ryoko自身のエンジンで捌く場合も第2のexternal runnerとして
Receiptを返す義務を負う。

### 3.8 見える化アーキテクチャ（投影の一本道）

> 委任は観測可能性の関数。承認を減らすほど見える化の重要度は上がる——**可視性は承認の代替物**。
> 台帳は誰かが自然に目にする形に投影されて初めて機能する。

**2原則**:

1. **投影の一本道**: すべての見える化面はBrainbase台帳（Run Receipt / Workflow Run / LoopIntent）
   から描画する。Ryoko素のCanvas同期（自セッション状態の描画）はデータソースを
   Brainbase投影API（読み取り専用・決定論集約）に付け替える。
   「見える物＝監査される物」を一致させ、何面増やしても真実は1つのまま
2. **Slackへの書き手はRyoko1人**: Cloudflare/computerはSlackに直接書かない。Cloudflare/computerの仕事ぶりは
   台帳→投影API→Ryoko経由でのみSlackに現れる。人格の一意性・ノイズ制御・レート制御を守る

**4つの面**:

| 面 | 更新契機 | 内容 |
|---|---|---|
| チャンネルCanvas | 状態変化時（+最大30秒poll） | 実行中/承認待ち/直近完了/**定期業務の健康**（登録ループごとの最終成功時刻） |
| スレッド投稿 | 節目のみ | 会話派生タスクの「受領→完了/blocked」。途中経過は書かない |
| 日報・週報 | 日次/週次（これ自体が業務ループ） | 台帳集約ダイジェスト+委任KPI（週次は実装済みスクリプト流用） |
| Companion | 例外発生時 | 委任境界の変更と例外のみ（§3.6） |

補足:

- **会話はCanvasに載せない**。会話はチャンネルにそのまま見えている（自己見える化）。
  Canvasの役割は「チャンネルから見えない裏の稼働を窓にする」こと
- 実行者（Cloudflare/computer/Ryoko）表記は添え書きの脇役。メンバーに重要なのは「何が動いているか」であって
  ランナーではない
- **不実行の見える化が最重要**。過去の障害はすべて「沈黙する失敗」（SNS poller stale、
  トンネル断のlearn daily停止）。Receiptの `blocked/unconfirmed/no_data` 区別を使い、
  Canvasに定期業務ごとの最終成功時刻を常設する（例: `SNS予約投稿 ⚠️ 最終成功26時間前`）
- 生ログ垂れ流し禁止。載せるのは安定状態（開始/マイルストーン/完了/blocked）のみ。
  詳細は「@manaに聞けば台帳MCP（run_receipt_inbox/history）から答える」に逃す。
  沈黙もまた見える化の一部（静かである＝正常、が信頼できること）

**Phase 1接続要件への追加**:

1. Brainbaseに投影API（台帳→チャンネル別集約、読み取り専用・決定論）を追加
2. Ryoko forkのCanvas同期のデータソースを投影APIへ差し替え（Slack配管は流用）
3. Cloudflare/computer dispatchの各Workflow Runに `channel_binding` を必須メタデータとして持たせる（§3.9）
4. スレッド発タスクは `thread_ref` を保持し、完了Receiptのingestをトリガに完了投稿

### 3.9 Canvas binding規則（どのCanvasに書くか）

**Canvas選択は表示の問題ではなく権限の問題**。チャンネルメンバーシップ＝権限マスク（§3.3）である
以上、宛先選択は「この仕事の存在を誰に見せてよいか」というACL判断。モデルの空気読みに任せず、
**起票時に決定論カスケードで確定**し、描画時は読むだけにする。

| 優先 | 起点 | 宛先 |
|---|---|---|
| 1 | スレッド発の会話派生タスク | そのスレッドのチャンネル（依頼の文脈に返す） |
| 2 | 登録済み業務ループ | catalogの宣言（channel_bindingを必須フィールド化。宛先の正本はrepo/Graph側） |
| 3 | project紐づきの仕事 | Graph SSOTの `project→デフォルトチャンネル` マッピング（「事実」なのでGraph正本） |
| 4 | どれにも該当しない | **運用ホームCanvas**（管理者向けチャンネル）へフォールバック |

- **フォールバック必須**:「宛先が決まらないから書かない」は闇業務の発生源。必ずどこかに落ちる
- **正本Canvasは1枚**（primary binding）。関係他チャンネルには完了通知のみ。
  同じ仕事を2枚に描くと更新ズレで状態齟齬が見える化され信頼を損なう
- **機微度はマスクで降格**: 宛先チャンネルのクリアランスが仕事の機微度より低い場合、
  行を消すのではなくマスクして載せる（「顧客案件の調査 1件 実行中」レベル）。存在は見せ、中身を絞る。
  判定はbinding確定時に決定論ルール＋PIIスキャン系の流用で行う
- **DM発の仕事**: チャンネルCanvasに載せず、そのDMスレッド内で完結（台帳には通常どおり載る）
- **ワークスペース境界**: WS＝人格・契約主体の境界。bindingは必ずWSレベルから決まり、
  跨ぎ仕事は契約主体のWSを正本にする（joint案件のインフラ法人主体割当と同じ型）

---

## 4. 段階進化ロードマップ

| Phase | 形 | 証明すること |
|---|---|---|
| **1** | 1人格・1ワーカー（Lightsailノード、unson WS、draft_only固定） | ノード1体が台帳接続で安全に回る |
| **1.5** | 1人格・Nワーカー（裏のfan-out + 権限マスク + スレッド署名） | 入り口を増やさずに処理能力だけスケールする |
| **2** | 少数人格・Nワーカー = **UnsonOS**（承認委譲・KPI駆動の自律度昇格・倫理=停止条件+昇格審査基準） | 委任境界が計測に基づいて広がる。社長は例外承認のみへ退く |
| **3** | 1人1ノード = **Mesh**（各メンバーPCに個人KG付きノード、mesh_queryでAI同士が会話） | 佐藤を起こさずに組織が回る |

- Phase 1で作るLightsailの1体 = **Meshの最初のノードの物理プロトタイプ**（mana代替はその副産物）
- Phase 2への移行判定は感覚ではなく、Companion Inboxの滞留とDecision KPIで行う

---

## 5. 誰がどれを使うか（小規模組織前提の非対称設計）

> メンバーの接面は全フェーズを通じて「Slackの@1体」だけ。増えるのは佐藤側の管理・承認面と、Phase 3での個人ノードのみ。

| 人 | Phase 1 | Phase 1.5 | Phase 2 | Phase 3 |
|---|---|---|---|---|
| メンバー・業務委託 | Slackのみ | 変化なし | ほぼ変化なし（WS別人格は現mana 3体制と同じ） | 個人ノードが入るが日常は「自分のAIにDM」のみ |
| 佐藤 | Slack + Companion承認 + CLI | 承認種類が増加、KPI週次確認 | **承認委譲開始**、例外承認と昇格審査のみへ | mesh_query監査 |
| 承認を委譲されたメンバー | — | — | Slack承認リアクション（実質Slackから出ない） | 同左 |
| 運用管理（佐藤/小松原） | Lightsailノード保守 + 台帳 | 同左 | 同左 | ノード配布・保守 |

- 教育コストゼロ設計:「@manaに話しかける」以外を要求した瞬間、この規模では使われなくなる
- 業務委託の権限はチャンネル参加＝ACLで解く（道具を増やさない）
- Phase 1〜2前半のボトルネックは意図的に「佐藤1人の承認」。溢れが可視化された時が委譲開始の合図

---

## 6. 今のステップ（着手順）

1. **ADR起草**:「ノードアーキテクチャと境界」
   - OpenRyoko=gatewayのみ借用（Triage・PTY・Canvas同期）、Todos/組織管理/承認は無効化
   - 台帳・承認・KPIはBrainbase一本（正本の二重化禁止）
   - Lightsailファイル配置ポリシー（§3.4）、資産/使い捨ての線引き（§3.2）、入り口/ワーカー独立スケール原則（§3.3）
2. **着手前検証3点**（どれかNGなら構成が変わるため先に潰す）
   - (a) OpenRyokoの3ワークスペース対応可否
   - (b) PTY/サブスク常駐運用のAnthropic規約適合
   - (c) Lightsail現行スペックでのClaude Code常駐可否（メモリ/CPU）
3. **Phase 1 StoryをVibePro化**: Lightsailノード PoC（draft_only・unson WS・Run Receipt/Decision KPI接続）。
   mana Lambdaは触らず並走フォールバック

---

## 7. Appendix

### 7.1 関連正本

- Agent-first分業: `docs/architecture/ADR-017-agent-first-product-surface.md`
- 4層脳モデル: `docs/architecture/ADR-006-brain-model-4-layer.md`
- 自律度・実行委譲境界: `docs/architecture/org-agent-loop-control-architecture.md`
- Cloudflare/computer接続: `docs/architecture/external-runner-adapter-contract-architecture.md`
- 判断委任KPI: `docs/architecture/decision-events-kpi-architecture.md`
- 脱属人化・自律運転への収束: `docs/frames/mesh-ai-driven-management.md`
- UnsonOS構想群: `docs/internal/unson-os-*.md`
- Distribution Model: `CLAUDE.md` §0.5

### 7.2 外部実例ソース

- OpenClaw: https://docs.openclaw.ai / https://github.com/openclaw/openclaw
- Hermes Agent: https://hermes-agent.nousresearch.com/docs / https://github.com/nousresearch/hermes-agent
- Jinn: https://github.com/hristo2612/jinn
- OpenRyoko: https://github.com/rsensui2/OpenRyoko / https://tekion.jp/openryoko
- OpenClawセキュリティ教訓: IBM X-Force / Snyk ToxicSkills / SecurityScorecard 各報告（2026）

### 7.3 用語

- **ノード**: 顔/体/脳/脳幹からなるAI社員の1単位。全フェーズで同型
- **ランナー**: `external_runner.v0` 契約で台帳に実行結果を返す実行体。現状2体
  — **Cloudflare/computer**（業務ループのbrowser/computer/tool実行runtime）と
  **OpenRyoko**（Lightsail常駐のJinn fork。会話・人格・チャネル層+PTYエンジン）
- **投影**: 台帳を正本として見える化面（Canvas/スレッド/日報/Companion）へ描画すること。
  面を増やしても真実は1つ
- **表の人格 / 裏のワーカー**: 入り口となるアイデンティティ（認知の都合で少数固定）と、実行エージェント（処理の都合で弾性）
- **UnsonOS**: ノード群に承認・昇格・倫理・RACIを敷くガバナンスOS（Phase 2）
- **Mesh**: 各人のPCの個人ノード同士がmesh_queryで会話する網（Phase 3）
