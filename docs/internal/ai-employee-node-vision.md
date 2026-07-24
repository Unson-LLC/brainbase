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
- **表の人格 / 裏のワーカー**: 入り口となるアイデンティティ（認知の都合で少数固定）と、実行エージェント（処理の都合で弾性）
- **UnsonOS**: ノード群に承認・昇格・倫理・RACIを敷くガバナンスOS（Phase 2）
- **Mesh**: 各人のPCの個人ノード同士がmesh_queryで会話する網（Phase 3）
