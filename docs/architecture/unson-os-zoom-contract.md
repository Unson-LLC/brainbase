# アーキテクチャ: UnsonOS ズーム契約

## 文書メタ情報

- 状態: 有効
- 種別: アーキテクチャ
- 主題: ズーム契約
- 親文書: [UnsonOS UI コンセプト](./unson-os-ui-concept.md)
- 派生元: [事業群運営ストーリー](../stories/unson-os-portfolio-operator-story.md)
- 関連文書: [経営者・事業責任者・現場責任者の通しシナリオ](../stories/unson-os-ceo-gm-lead-scenario.md), [UnsonOS UI×制御面 整合性マトリクス](./unson-os-ui-architecture-alignment.md)
- 置換: なし

## 位置づけ

この文書は、経営者 / 事業責任者 / 現場責任者が **同じ会社を違う高度で運営している** と感じられるための、UnsonOS のズーム契約を定義する。

世界観の価値は、地図が気持ちいいことではない。  
次の 3 つが成立していることにある。

- 同じ object が、役割ごとに別 projection で見える
- 上位状態が下位状態へ還元できる
- 上位判断が下位運用へ因果的に落ちる

この契約がないと、世界観は `CEO 用の気持ちいいマップ` で終わる。

## 基本原則

### 1. 世界は 1 つ、カメラだけが変わる

経営者 / 事業責任者 / 現場責任者で別プロダクトを作らない。  
変えるのは次だけに限定する。

- 既定の縮尺
- 既定のソート
- 既定の要約粒度
- 既定の主操作
- 可視化される hotspot

### 2. object identity は不変

次の object は、役割をまたいでも同一 identity を保つ。

- `Company`
- `Project / Program`
- `Initiative`
- `Decision`
- `Escalation`
- `Artifact / Evidence`

### 3. state は還元可能である

経営者が「この会社は危ない」と見たなら、事業責任者では「この施策群が滞留」、現場責任者では「このゲートと証跡不足が原因」と分解できなければならない。

### 4. action は連鎖可能である

経営者の `expand / hold / stop` は、事業責任者の `allocation / reprioritize / escalation policy` に落ち、現場責任者の `reroute / gate review / artifact request` に翻訳される必要がある。

## 役割ごとの既定縮尺

| 役割 | 既定の縮尺 | 主に見るもの | 主に変えるもの |
|---|---|---|---|
| 経営者 | `Holding Region / Company City` | 会社群、会社比較、投資配分、全社リスク | 配分、greenlight、stop、下位方針 |
| 事業責任者 | `Company City / District` | 会社内の project / program、initiative cluster、会社内キュー | reprioritize、assign capacity、approve、reroute policy |
| 現場責任者 | `District / Building / Flow` | 施策、checkpoint、blocked、evidence gap、判断待ち一覧 | gate、artifact request、reroute、escalate up |

## 不変にするもの

次は、どの縮尺でも同一 object の別要約として扱う。

- selected company
- selected project / program
- selected initiative cluster
- objective
- risk
- blocked
- approval pending
- evidence gap
- decision history

## 役割ごとに変えるもの

### 経営者

- 既定ソート: company health、strategic value、allocation load
- 既定要約粒度: 会社単位
- 主操作:
  - `allocate`
  - `greenlight`
  - `hold`
  - `stop`
  - `escalateDown`

### 事業責任者

- 既定ソート: company 内 initiative priority、cluster risk、capacity load
- 既定要約粒度: project / program と initiative cluster
- 主操作:
  - `reprioritize`
  - `assignCapacity`
  - `approve`
  - `reroutePolicy`
  - `openLeadEscalation`

### 現場責任者

- 既定ソート: blocked、approval pending、evidence gap、chain health
- 既定要約粒度: initiative、checkpoint、decision item
- 主操作:
  - `gate`
  - `requestArtifact`
  - `reroute`
  - `logRationale`
  - `escalateUp`

## 上下遷移時に保持するコンテキスト

役割や縮尺が変わっても、次の context は保持される。

- selected company
- selected project / program
- selected initiative cluster
- current risk lens
- current decision queue filter
- current time horizon

保持しないもの:

- 役割ごとの一時的な panel open state
- freeform chat 入力欄の内容
- raw transcript の表示位置

## 層間遷移契約

### 経営者 -> 事業責任者

**入口**

- company city を選ぶ
- company-level alert を開く
- allocation anomaly を開く

**保持する object**

- company
- risk lens
- decision queue filter

**変換されるもの**

- 経営者の company summary
  → 事業責任者の project / initiative cluster summary
- 経営者の strategic concern
  → 事業責任者の reprioritize candidate

### 事業責任者 -> 現場責任者

**入口**

- district を選ぶ
- 停滞群を開く
- company 内 escalation item を開く

**保持する object**

- company
- project / program
- selected initiative cluster
- risk lens

**変換されるもの**

- 事業責任者の initiative cluster issue
  → 現場責任者の checkpoint / evidence / gate issue
- 事業責任者の capacity concern
  → 現場責任者の reroute / artifact request 候補

### 現場責任者 -> 事業責任者

**入口**

- `Escalation Packet`
- unresolved risk
- repeated gate failure
- evidence gap not recoverable

**上げるもの**

- issue summary
- options
- recommendation
- linked evidence
- impact range

### 事業責任者 -> 経営者

**入口**

- company-level allocation conflict
- repeated initiative failure
- major approval request
- cross-company resource tradeoff

**上げるもの**

- business impact
- company-level risk
- recommended allocation change
- unresolved decision chain

## decision chain と evidence chain

### decision chain

同じ decision は、役割ごとに次のように見える。

- 経営者: `会社の優先度変更`
- 事業責任者: `initiative cluster の再優先順位付け`
- 現場責任者: `specific reroute / gate / artifact request`

### evidence chain

同じ evidence は、役割ごとに次のように要約される。

- 経営者: `この会社の健全性を下げた主要因`
- 事業責任者: `この cluster を止めている主要不足`
- 現場責任者: `この checkpoint を通せない具体的不足`

## アンチパターン

- 経営者は都市マップ、事業責任者は表、現場責任者は flow だが、相互遷移するとただ filter されるだけ
- object identity が変わり、上位と下位で別概念になる
- evidence chain が切れ、上位判断の理由を下位で辿れない
- 現場責任者の reroute が 事業責任者 / 経営者 の decision 面へ戻らない
- world layer が decorative skin で、default lens や suggested action を変えない

## v0 でまず成立させる最低限

1. `Company` を選んで事業責任者 view に降りる
2. `Project / Program` を選んで現場責任者 view に降りる
3. `停滞中の施策` から `論点整理室` を開く
4. `上申資料` を事業責任者へ上げる
5. その資料から company-level の判断待ち一覧に戻れる

この 5 つが通れば、世界観は decoration ではなく運営座標系になる。

## 関連文書

- [`unson-os-canonical-domain.md`](/Volumes/UNSON-DRIVE/brainbase-worktrees/session-1773022945038-brainbase/docs/architecture/unson-os-canonical-domain.md)
- [`unson-os-ui-concept.md`](/Volumes/UNSON-DRIVE/brainbase-worktrees/session-1773022945038-brainbase/docs/architecture/unson-os-ui-concept.md)
- [`unson-os-lead-control-console.md`](/Volumes/UNSON-DRIVE/brainbase-worktrees/session-1773022945038-brainbase/docs/architecture/unson-os-lead-control-console.md)
- [`unson-os-terminology.md`](/Volumes/UNSON-DRIVE/brainbase-worktrees/session-1773022945038-brainbase/docs/architecture/unson-os-terminology.md)
