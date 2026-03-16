# アーキテクチャ: UnsonOS 正準ドメイン

## 文書メタ情報

- 状態: 有効
- 種別: アーキテクチャ
- 主題: 正準ドメイン
- 親文書: [UnsonOS 実行基盤と UI](../frames/unson-os-runtime-ui-frame.md)
- 派生元: [エージェント組織基盤ストーリー](../stories/unson-os-agent-org-foundation-story.md)
- 関連文書: [UnsonOS 現場責任者ランタイム構成](./unson-os-lead-runtime-architecture.md), [エージェント組織基盤仕様](../specs/unson-os-agent-org-foundation-spec.md)
- 置換: なし

## 位置づけ

UnsonOS の母艦は `Brainbase` でも `Paperclip` でもなく、**UnsonOS 自身の正準ドメイン** とする。  
この文書は、既存ツールや既存世界観より先に固定すべき「正本の概念単位」を定義する。

目的は次の 3 つ。

- `Brainbase` の operator / workbench 文法に引っ張られないこと
- `Paperclip` の company / ticket / heartbeat 文法に丸ごと従属しないこと
- manager / executive 向けの意思決定面を、自前の正本から組み立てられるようにすること

## 基本原則

### 1. 世界観は projection であり、正本ではない

`Holding Region / Company City / District / Building / Room` は **見え方** のための projection 名である。  
正本のドメイン名としては使わない。

### 2. transcript は捨てないが、主成果物にもしない

会話や実行ログは、事後検証、障害解析、説明責任のための **forensic substrate** として保持する。  
一方で manager-facing の成果物は transcript ではなく、`Decision Memo`、`Escalation Packet`、`Rationale` などの判断 object に変換する。

### 3. 画面の主語と正本の主語を揃える

UI が扱う主な判断単位は次の順で揃える。

1. `Portfolio`
2. `Company`
3. `Project / Program`
4. `Initiative`
5. `Run / Checkpoint`
6. `Decision / Escalation`
7. `Artifact / Evidence`
8. `Communication / Decision Record`

### 4. 画面表示は日本語、正本キーは英語にする

画面表示では、次のように日本語を優先する。

- `Portfolio` → 事業群
- `Company` → 事業
- `Project / Program` → 区画の親単位
- `Initiative` → 施策
- `Decision` → 判断
- `Escalation` → 上申
- `Artifact` → 成果物
- `Evidence` → 証跡

一方で、コード、DB、外部連携のキーは英語のまま維持する。

## 正準オブジェクトモデル

### 1. Portfolio

**意味**  
持株全体、または複数会社を束ねる経営単位。

**責務**

- 会社横断の優先順位
- 資源配分
- 会社間の比較
- ポートフォリオ全体のリスク把握

### 2. Company

**意味**  
法的・経営的な事業運営単位。  
ユーザーの現実運用では「4つの会社」がここに対応する。

**責務**

- 会社単位の戦略
- 会社単位の承認境界
- 会社単位の予算やキャパシティ
- 会社単位の監査境界

### 3. Project / Program

**意味**  
Company 配下で継続運用される実行単位。  
initiative より寿命が長く、空間的にも安定した区画として扱いやすい。

**責務**

- objective と KPI の保持
- 継続的な流れの受け皿
- initiative 群の所属先

### 4. Initiative

**意味**  
特定期間に進める重点施策、賭け、推進対象。  
週次・月次で立ち上がっては収束する判断単位。

**責務**

- priority / allocation の対象
- manager の主要判断対象
- flow と decision の結節点

### 5. Story

**意味**  
initiative の中で流れる進行単位。  
`ストーリー -> スコープ -> 計画 -> 実行 -> 検証 -> 承認 -> 出荷 -> 学習`
の流れを持つ。

**責務**

- フロー管理
- checkpoint の束ね役
- run の上位単位

### 6. Run

**意味**  
AI または人間を含む具体的な実行単位。

**責務**

- 実行状態
- 実行者
- 開始/終了
- trace の束ね

### 7. Checkpoint

**意味**  
run や story の途中で止める、通す、差し戻すための判定点。

**責務**

- gate 条件
- retry / reroute 判断
- approval 要否

### 8. Decision

**意味**  
人間または policy による裁定単位。

**責務**

- approve / reject / defer
- 採用理由
- 却下理由
- 影響範囲

### 9. Escalation

**意味**  
現場責任者から事業責任者、事業責任者から経営者へ論点を持ち上げる単位。

**責務**

- 上申理由
- unresolved risk
- options
- recommendation

### 10. Artifact

**意味**  
成果物そのもの。  
文書、コード、設定差分、メモ、レポートなど。

### 11. Evidence

**意味**  
判断や承認を支える根拠。  
artifact と同一ではなく、判断に紐づく説明可能性の材料を含む。

### 12. Approval Request

**意味**  
特定の checkpoint や decision に対して人間判断を要求する object。

### 13. Agent Assignment

**意味**  
どの AI / 人間 / チームが、どの initiative / story / run を担うかの割り当て。

### 14. Capacity Allocation

**意味**  
キャパシティの配分状態。  
manager / executive が見るべき資源配分の正本。

### 15. Transcript Trace

**意味**  
会話、ツール呼び出し、実行ログ、トレースの保持単位。  
主成果物ではないが、Detail 層と監査用途では必須。

### 16. Communication

**意味**  
AI⇆AI、AI⇆人、人⇆人、外部ツール⇆人の連絡を、同じ型で保持する連絡 object。

**責務**

- 連絡の正本を 1 箇所に集める
- 誰が誰に何を求めたかを裁ける単位にする
- 外部ツールを配信先・入力窓口として扱い、正本を散らさない

**主要な目的分類**

- `Instruction` = 指示
- `Report` = 報告
- `Consultation` = 相談
- `Decision Request` = 判断依頼
- `Approval Request` = 承認依頼
- `Evidence Request` = 証跡要求
- `Send Back` = 差戻し
- `Escalation` = 上申

**最低限の項目**

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

### 17. Decision Record

**意味**  
判断メモ、上申資料、判断理由など、会話を裁定可能な成果物へ変換した保持単位。

**責務**

- transcript をそのまま成果物にしない
- 判断の結果、採用理由、却下理由、参照証跡を残す
- 上申、承認、差戻しの経路を追えるようにする

## projection 名との対応

| 正準オブジェクト | world / UI projection 名 | 補足 |
|---|---|---|
| `Portfolio` | `Holding Region` | 複数会社を束ねる上位地図 |
| `Company` | `Company City / Campus` | 会社ごとの都市・キャンパス |
| `Project / Program` | `District` | 継続性のある区画 |
| `Initiative` | `District overlay / project agenda` | 区画そのものではなく、その区画で今強める施策 |
| `Story / Run / Checkpoint` | `Building / Room / Lane` | 実行線と局所判断点 |
| `Artifact / Evidence / Transcript Trace` | `Vault / Archive / Workbench` | 監査・詳細・検証用途 |
| `Communication / Decision Record` | `Communication Surface / Inbox / Decision Queue` | 連絡と判断の横断面 |

画面表示では次のように読む。

- `Holding Region` = 事業圏
- `Company City / Campus` = 事業都市 / 事業拠点
- `District` = 区画
- `Workbench` = 作業台

## なぜ District を Project / Program に寄せるか

`Initiative = District` にすると、週次や月次の施策変化に応じて地理そのものが揺れやすい。  
これでは world が空間認知の道具ではなく、頻繁に変わる skin になる。

したがって UnsonOS では、

- `District` = 継続性のある `Project / Program`
- `Initiative` = その区画に重なる重点施策

として扱う。

## 正本と projection の境界

### 正本として保持するもの

- company
- project / program
- initiative
- story
- run
- checkpoint
- decision
- escalation
- artifact
- evidence
- communication
- decision record
- transcript trace

## 連絡の正本

UnsonOS は **会話の場所** ではなく、**連絡の正本** を持つ。  
Slack、Gmail、GitHub、Notion、NocoDB、Drive、Calendar などは残してよい。  
ただし、それぞれを判断や進行の正本にしてはいけない。

### 残す正本

- GitHub: コード、PR、Issue、CI/CD、リリース証跡
- Drive: ファイルと成果物
- Calendar: 予定
- Gmail: 社外メール
- Notion: 文書
- UnsonOS: 進行、判断、上申、承認、証跡参照、連絡台帳

### 長期的に正本にしないもの

- Slack スレッドによる判断履歴
- Notion DB の live 進行管理
- NocoDB の本番運用の主台帳
- Gmail の社内承認
- Drive フォルダによる状態管理

## transcript の扱い

transcript は **保持する**。  
ただし manager-facing の主成果物にしない。

- transcript = forensic substrate
- decision record = manager-facing な成果物
- communication = 裁ける単位の連絡

この 3 つを混同しないことを原則にする。
- evidence
- approval request
- agent assignment
- capacity allocation
- transcript trace

### projection として組み立てるもの

- world map
- city / campus
- district heat
- building hotspot
- lane summary
- live ops summary
- decision queue view

## 既存プロダクトとの接続方針

### Brainbase

`Brainbase` は `Transcript Trace`、`Artifact`、`Workbench` の側に寄せる。  
正本の `Portfolio / Company / Initiative / Decision` は持たせない。

### Paperclip

`Paperclip` は `Company`、`Approval Request`、`Audit`、`Heartbeat` の実行基盤候補として接続する。  
ただし `ticket` や `company` の用語をそのまま正準ドメインには採用しない。

### OpenGoat

`OpenGoat` は `Agent Assignment`、`Run`、`Session Continuity` の比較対象または任意アダプタ候補として扱う。  
ただし manager-facing の正本は持たせない。

## 最低限の実装順

1. `Company`
2. `Project / Program`
3. `Initiative`
4. `Decision / Escalation`
5. `Run / Checkpoint`
6. `Artifact / Evidence`
7. `Transcript Trace`

この順に固定すると、manager-facing の意思決定面から先に組み立てやすい。

## 関連文書

- [`unson-os-ui-concept.md`](/Volumes/UNSON-DRIVE/brainbase-worktrees/session-1773022945038-brainbase/docs/architecture/unson-os-ui-concept.md)
- [`unson-os-lead-control-console.md`](/Volumes/UNSON-DRIVE/brainbase-worktrees/session-1773022945038-brainbase/docs/architecture/unson-os-lead-control-console.md)
