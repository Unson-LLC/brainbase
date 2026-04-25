# AI-first Brainbase Story Map Draft

## 位置づけ

この文書は、Brainbase に AI-first を取り込むための Story Map 叩き台である。

ここで扱う AI-first は「AI ツールを導入すること」ではない。AI が安全に仕事できるように、会社の正本、状態管理、実行制御、検証、人間の判断境界を作り直すことである。

既存の S1-S6 Ship は、この Story Map 全体のうち `quarter.brainbase.ai-readable-ssot` 配下の初期 Ship として扱う。

## Frame

```yaml
frame_id: frame-2026-ai-first-company-os
name: "AI が安全に仕事できる会社 OS"
user_ecosystem: "少人数（社員＋業務委託）で複数事業を運営し、AI agent に作業を委譲したいが、文脈・判断・状態が複数の人間と複数の PC に散らばっている組織"
value_hypothesis: "会社の情報を、集約すべき層（Meaning / State / Evidence）と分散すべき層（各メンバーの作業文脈）に分離し、それぞれを AI が読める形で接続する。集約層は Brainbase 正本に集約し、分散層は各メンバー PC 上の AI agent がローカルで保持したまま、必要時にリアルタイム問い合わせで橋渡す。これにより agent fleet と mana が観測・実行・検証を回し、人間は判断と例外処理に集中できる。"
delivery_model: "Brainbase 内部で運用を確立し、VibePro の control plane として外部化する"
```

### 情報の二層モデル

| 層 | 内容 | 居場所 | 接続方法 |
|---|---|---|---|
| **集約層 (Aggregation)** | Meaning（会社の意図・原則・ストーリー）、State（タスク・スプリント・シップ）、Evidence（成果物・証跡） | Git/_codex、NocoDB、GitHub/Drive | 全メンバーが直接参照 |
| **分散層 (Distribution)** | 各メンバーの作業文脈（コード状態、worktree、Claude Code 会話履歴、試行錯誤、暗黙知） | 各メンバーの PC | Mesh 経由のリアルタイム問い合わせ |

**集約層は移動可能、分散層は移動不能** という現実に基づく。会話ログや作業文脈を中央に集約しようとすると、情報量爆発・個人情報漏洩・SSOT 肥大化を引き起こす。

### 固定すること

- 集約層の正本は「AI が読むもの」として設計する
- 分散層は集約せず、各メンバー PC に残したまま AI 同士のリアルタイム問い合わせで橋渡す
- Slack と会議はフローであり、正本ではない
- タスクは「やることメモ」ではなく、会社の現在状態である
- 人間は line-level reviewer ではなく、判断者、設計者、例外処理者である
- AI は自由に作るのではなく、文脈、制約、証拠要件、gate に従って実行する

### 含めないこと

- 何でも自動化すること
- 人間の承認なしに外部送信、課金、削除、公開を行うこと
- 分散層を強制的に集約しようとすること（個人情報・暗黙知・会話履歴の中央収集）
- UI やドキュメント整備だけで AI-first とみなすこと
- Ship を先に増やして Story Map を後追いにすること

---

## Northstar / Business

```yaml
story_id: northstar.brainbase.ai-first-company-os
frame_id: frame-2026-ai-first-company-os
horizon: northstar
view: business
name: "Brainbase を AI-first な会社 OS にする"
enemy: "AI ツールは増えたが、文脈・判断・状態が人間の頭と会議に残り、結局人間がボトルネックになること"
non_goal:
  - "AI に自由裁量で会社運営を任せること"
  - "既存業務に AI ツールを足すだけで済ませること"
  - "Brainbase を単なるドキュメント管理やタスク管理に留めること"
criteria:
  - type: commit
    description: "集約層: 会社の意味、状態、判断基準、実行ログが Brainbase の正本スタックに接続されている"
  - type: commit
    description: "分散層: 各メンバー PC 上の AI agent がローカル文脈を保持したまま、権限付きで相互に問い合わせ・応答できる"
  - type: commit
    description: "mana が集約層の状態変化を観測、通知、起票、追跡を担い、人間が探しに行かなくても停滞や異常が浮上する"
  - type: commit
    description: "Codex/Claude が集約層の正本を読み、必要に応じて分散層の他ノードに問い合わせ、制約付きで実行し、機械 gate と証跡を通して作業できる"
  - type: signal
    description: "会議が情報共有ではなく意思決定に寄る"
  - type: signal
    description: "佐藤への口頭確認や文脈補足が減り、メンバーと AI が正本＋分散ノードを参照して自走する"
  - type: signal
    description: "業務委託メンバー間の連携で社長を経由する回数が減る"
```

### 意味

Brainbase の AI-first 化は、AI で作業量を増やすことではない。人間の認知帯域をボトルネックにしないために、会社の工程、正本、検証、責任分界を作り直すことである。

---

## Annual / Org Dev

```yaml
story_id: annual.brainbase.ai-first-operating-loop
frame_id: frame-2026-ai-first-company-os
horizon: annual
view: business
name: "AI-first operating loop を確立する"
enemy: "正本、agent 実行、mana 観測、人間判断が分断され、AI が毎回文脈不足で止まること"
non_goal:
  - "全領域を一度に自動化しない"
  - "個別 skill や個別 bot の増殖で解決しない"
  - "人間レビューを単に増やして安全性を担保しない"
criteria:
  - type: commit
    description: "Meaning は Git/_codex/docs、State は NocoDB、Evidence は GitHub/Drive/ログに分離され、相互参照できる"
  - type: commit
    description: "mana が状態変化を観測し、必要な task/issue/ship 候補を起票できる"
  - type: commit
    description: "agent fleet が Story/Architecture/Spec/TDD/Code の順序を守って実行できる"
  - type: commit
    description: "Human Gate が Frame、Story、Approval、Ship の境界で定義されている"
  - type: signal
    description: "情報共有会議より、正本更新と意思決定ログで組織が回る"
```

### Operating Loop

```text
Meaning / Story
  -> State / Task / Ship
  -> Agent Execution
  -> Mechanical Gate
  -> Evidence / Audit
  -> mana Observation
  -> Human Decision
  -> Meaning / State update
```

---

## Quarter 1 / Dev

```yaml
story_id: quarter.brainbase.ai-readable-ssot
parent_story_id: annual.brainbase.ai-first-operating-loop
horizon: quarter
view: dev
name: "AI-readable SSOT を固める"
enemy: "正本が複数箇所に散り、AI も人間も何を読めばよいか分からないこと"
non_goal:
  - "全ドキュメントを人間向けに綺麗に整えることを主目的にしない"
  - "状態まで Git に閉じ込めない"
  - "Slack や会議メモを正本として扱わない"
criteria:
  - type: commit
    description: "_codex/docs/CLAUDE.md/Skills/NocoDB/GitHub/Drive の役割分担が定義される"
  - type: commit
    description: "役割別ビューが正本から生成または更新できる"
  - type: commit
    description: "議事録や壁打ちから正本候補を抽出し、人間レビューへ回せる"
  - type: signal
    description: "佐藤に聞かずに、各役割が自分の入口から必要情報に到達できる"
```

### 対応する既存 Ship

```yaml
ships:
  - id: 22
    title: "S1: brainbase正本マップ（_codex・wiki・Skills・CLAUDE.mdの全体地図）"
  - id: 23
    title: "S2: 役割別ビュー5種（経営者/PM/エンジニア/事務/外部パートナー）"
  - id: 24
    title: "S3: 俗化生成Skill（正本→役割別ビュー自動生成）"
  - id: 25
    title: "S4: 議事録→正本キャプチャパイプライン（山本の口頭設計を自動回収）"
  - id: 26
    title: "S5: 俗化運用手順書（梅田用：整形・配布・更新管理）"
  - id: 27
    title: "S6: 月次俗化レビューサイクル（佐藤→山本→AI→梅田の定常運用）"
```

---

## Quarter 2 / Ops

```yaml
story_id: quarter.brainbase.mana-ambient-agent-loop
parent_story_id: annual.brainbase.ai-first-operating-loop
horizon: quarter
view: dev
name: "mana を ambient agent にする"
enemy: "人間が毎回 Brainbase を見に行き、遅延・停滞・障害を手動で探すこと"
non_goal:
  - "通知だけ増やして状態更新しないこと"
  - "mana が外部アクションを承認なしに実行すること"
  - "M1-M9 の個別処理を増やすだけで統合 loop を作らないこと"
criteria:
  - type: commit
    description: "mana が NocoDB/GitHub/Slack/ログを観測し、停滞、期限超過、障害、未処理状態を検知できる"
  - type: commit
    description: "検知結果が task/issue/ship 候補として NocoDB に反映される"
  - type: commit
    description: "Slack 通知は状態更新や人間判断に接続される"
  - type: signal
    description: "人間が探す前に mana が拾ってくる事例が週次で発生する"
```

### 初期 Event の種

- `decision`: mana ambient agent の責任範囲を採択した
- `work`: 観測対象と検知条件を定義する
- `work`: 検知結果を NocoDB task/issue/ship 候補へ変換する
- `work`: Slack 通知から人間判断と状態更新へ接続する
- `learn`: 誤検知、通知疲れ、未処理滞留を振り返る

---

## Quarter 3 / Dev

```yaml
story_id: quarter.brainbase.agent-fleet-execution
parent_story_id: annual.brainbase.ai-first-operating-loop
horizon: quarter
view: dev
name: "Codex/Claude agent fleet の実行基盤を標準化する"
enemy: "AI が文脈不足のまま自由に実行し、人間レビューで初めて問題が見つかること"
non_goal:
  - "agent の数を増やすことを成果にしない"
  - "人間レビューを安全性の主 gate にしない"
  - "Story や Spec を飛ばして実装に進まない"
criteria:
  - type: commit
    description: "agent 実行前に読む正本、Skill、制約、証拠要件が定義される"
  - type: commit
    description: "Story -> Architecture -> Spec -> TDD -> Code の順序が実行制御に組み込まれる"
  - type: commit
    description: "lint/test/typecheck/security/contract/evidence check が人間レビュー前の gate になる"
  - type: commit
    description: "実行ログ、判断ログ、失敗ログ、証跡が Brainbase に戻る"
  - type: signal
    description: "人間レビューが行単位ではなく、リスク、価値、境界条件に集中する"
```

### 初期 Event の種

- `decision`: agent fleet 実行標準を採択した
- `work`: agent input contract を定義する
- `work`: mechanical gate の最小セットを定義する
- `work`: evidence/audit の保存先と参照方法を決める
- `work`: Human Gate と mechanical gate の責任境界を定義する

---

## Quarter 3.5 / Distributed

```yaml
story_id: quarter.brainbase.distributed-agent-mesh
parent_story_id: annual.brainbase.ai-first-operating-loop
horizon: quarter
view: dev
name: "分散層: 各メンバー PC 上の AI agent をリアルタイム連携基盤で繋ぐ"
enemy: "業務委託メンバーの作業文脈が各自の PC に閉じ、社長の脳が唯一の全体像統合ポイントになっていること"
non_goal:
  - "各メンバーの会話ログ・terminal output・個人ファイルを中央に集約しないこと"
  - "agent の自由裁量で会社運営を進めないこと（権限境界を破らない）"
  - "メンバー追加のたびに招待コードや個別設定を強いること"
criteria:
  - type: commit
    description: "各メンバー PC で起動した Brainbase が、Slack ログイン後に自動でメッシュへ参加できる"
  - type: commit
    description: "あるノードの AI agent が、権限の範囲内で他ノードの AI agent に問い合わせ、ローカル文脈に基づく構造化応答を受け取れる"
  - type: commit
    description: "問い合わせ・応答は暗号化され、Relay 管理者を含む第三者は内容を復元できない"
  - type: commit
    description: "ROLE_RANK と config.yml の assignees に基づき、誰がどのノードに何を聞けるかが組織権限と一致する"
  - type: commit
    description: "メンバーオフボーディング時に暗号鍵を失効し、以後の問い合わせを遮断できる"
  - type: signal
    description: "社長への口頭・Slack確認の頻度が下がり、社長 AI が一斉問い合わせで全体像を構築できる"
  - type: signal
    description: "業務委託メンバー間の連携が社長を経由せずに成立する"
```

### 集約層との関係

このストーリーは **集約層を置き換えるものではなく、補完するもの**：

- 集約すべき情報（タスク、マイルストーン、シップ）は引き続き NocoDB に集約
- 分散したままにすべき情報（コード変更、worktree 状態、Claude Code 文脈）はメンバー PC に残す
- Mesh はその橋渡しのみ
- mana は集約層を観測し続ける（Mesh の Query/Response はフロー、Evidence にはしない）

### 初期 Event の種

- `decision`: 分散層を集約せず Mesh で橋渡す方針を採択した
- `work`: Mesh MVP（暗号化 envelope + Relay + QueryHandler）を実装する
- `work`: Slack ログインから自動メッシュ参加までの統合を実装する
- `work`: ROLE_RANK ベースの権限チェックを実装する
- `ship`: 業務委託メンバーへ配布し、社長 AI からの一斉問い合わせを実運用する

---

## Quarter 4 / Product

```yaml
story_id: quarter.vibepro.control-plane-productization
parent_story_id: annual.brainbase.ai-first-operating-loop
horizon: quarter
view: business
name: "Brainbase で回った AI-first operating loop を VibePro control plane として外部化する"
enemy: "Brainbase 内部運用で終わり、商用価値として再利用可能な control plane に変換されないこと"
non_goal:
  - "Brainbase そのものを外販すること"
  - "診断なしに顧客環境へ agent 実行を持ち込むこと"
  - "顧客ごとに個別受託で作り込むこと"
criteria:
  - type: commit
    description: "Meaning Plane / Knowledge Plane / Control Plane が VibePro の商品仕様に落ちる"
  - type: commit
    description: "Frame -> Story -> Event -> Architecture -> Spec -> TDD -> Code が実行 DAG として説明できる"
  - type: commit
    description: "Human Gate、mechanical gate、audit/report が顧客向けに説明可能になる"
  - type: signal
    description: "VibePro の提案で、単発実装ではなく継続改善 control plane として説明される"
```

### VibePro への接続

```text
Brainbase internal operating loop
  -> reusable diagnosis
  -> VibePro control plane
  -> customer AI product operations
```

---

## Month Stories / 初期分解

### Month 1: SSOT Map

```yaml
story_id: month.brainbase.ssot-map-and-role-views
parent_story_id: quarter.brainbase.ai-readable-ssot
name: "正本マップと役割別ビューを作る"
ships:
  - 22
  - 23
criteria:
  - "正本マップが作成される"
  - "5種の役割別ビューの仕様が決まる"
  - "各ビューの対象者と用途が明確になる"
```

### Month 2: SSOT Generation Pipeline

```yaml
story_id: month.brainbase.ssot-generation-pipeline
parent_story_id: quarter.brainbase.ai-readable-ssot
name: "正本からビューを生成し、議事録から正本候補を回収する"
ships:
  - 24
  - 25
criteria:
  - "俗化生成 Skill が動く"
  - "議事録から正本候補を抽出できる"
  - "人間レビュー前に候補の根拠が示される"
```

### Month 3: SSOT Operation Cycle

```yaml
story_id: month.brainbase.ssot-operation-cycle
parent_story_id: quarter.brainbase.ai-readable-ssot
name: "俗化運用を人間の定常業務に移管する"
ships:
  - 26
  - 27
criteria:
  - "梅田用の運用手順がある"
  - "月次レビューサイクルがカレンダー固定される"
  - "生成、レビュー、整形、配布、更新が一巡する"
```

### Month 4: mana Detection Contract

```yaml
story_id: month.brainbase.mana-detection-contract
parent_story_id: quarter.brainbase.mana-ambient-agent-loop
name: "mana の観測対象と検知条件を定義する"
criteria:
  - "観測対象が NocoDB/GitHub/Slack/log に分かれて定義される"
  - "停滞、期限超過、障害、未処理状態の検知条件が定義される"
  - "検知結果の task/issue/ship 変換ルールが定義される"
```

### Month 5: Agent Fleet Contract

```yaml
story_id: month.brainbase.agent-fleet-contract
parent_story_id: quarter.brainbase.agent-fleet-execution
name: "agent fleet の入力契約と gate を定義する"
criteria:
  - "agent が実行前に読む正本セットが定義される"
  - "forbidden_changes と required_evidence が必須化される"
  - "mechanical gate の最小セットが定義される"
```

### Month 6: VibePro Control Plane Definition

```yaml
story_id: month.vibepro.control-plane-definition
parent_story_id: quarter.vibepro.control-plane-productization
name: "VibePro control plane の商品仕様を定義する"
criteria:
  - "Meaning Plane / Knowledge Plane / Control Plane の責務が定義される"
  - "Human Gate と audit/report の見せ方が定義される"
  - "診断、実装、継続改善への接続が説明できる"
```

### Month 7: Mesh MVP Foundation

```yaml
story_id: month.brainbase.mesh-mvp-foundation
parent_story_id: quarter.brainbase.distributed-agent-mesh
name: "Mesh MVP の通信・暗号・問い合わせ基盤を実装する"
criteria:
  - "暗号化 envelope と Relay Server で 2 ノード間の安全な通信が成立する"
  - "QueryHandler が config.yml の workspace scope に従ってローカル文脈を構造化応答する"
  - "ROLE_RANK ベースの権限チェックが Worker / GM / CEO で正しく分岐する"
  - "MCP Tool（mesh_query / mesh_peers）が Claude Code から呼べる"
  - "Slack ログイン → Node Profile 構築 → メッシュ参加が自動化されている"
```

---

## Story 間の接続

```text
frame-2026-ai-first-company-os
  -> northstar.brainbase.ai-first-company-os
    -> annual.brainbase.ai-first-operating-loop
      -> quarter.brainbase.ai-readable-ssot
        -> month.brainbase.ssot-map-and-role-views
        -> month.brainbase.ssot-generation-pipeline
        -> month.brainbase.ssot-operation-cycle
      -> quarter.brainbase.mana-ambient-agent-loop
        -> month.brainbase.mana-detection-contract
      -> quarter.brainbase.agent-fleet-execution
        -> month.brainbase.agent-fleet-contract
      -> quarter.brainbase.distributed-agent-mesh
        -> month.brainbase.mesh-mvp-foundation
          -> sprint: STR-001 mesh-agent-query (docs/stories/mesh-agent-query-story.md)
      -> quarter.vibepro.control-plane-productization
        -> month.vibepro.control-plane-definition
```

---

## 次に決めること

- この Story Map を `docs/stories/brainbase-story.md` に統合するか、AI-first 専用正本として分けるか
- NocoDB の Story テーブルへ登録する単位を `quarter` までにするか、`month` まで登録するか
- 既存 Ship S1-S6 の関連 Story を `quarter.brainbase.ai-readable-ssot` 配下へ紐付け直すか
- Quarter 2 以降の Ship をいつ作るか
