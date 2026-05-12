---
adr_id: ADR-011
title: SNS Posting Ledger 境界
status: accepted
date: 2026-05-12
related_stories:
  - story-sns-posting-cockpit
related_docs:
  - docs/stories/sns-posting-cockpit-mvp-story.md
  - docs/stories/knowledge-graph-kernel-story-map.md
  - docs/architecture/ADR-006-brain-model-4-layer.md
  - docs/architecture/ADR-010-memory-promotion-kernel-boundary.md
supersedes: []
superseded_by: []
---

# ADR-011: SNS Posting Ledger 境界

## 文脈

SNS line は、週次コンテンツ設計、個人 KG memory、Peer Circle signal、ニュース signal、Persona Brain、Graph Check、決定論的 quality gate から、レビュー可能な投稿案を生成できる状態になった。

これで「投稿文を作る」問題は中心ではなくなった。次の中心問題は、投稿案が review / schedule / posting / feedback / learning の状態を移動するための durable な置き場を持つこと。

実装前に、次の 2 つの境界を固定する必要がある。

- この状態を Graph に置くのか、別の運用 store に置くのか
- その store は別インフラにするのか、既存 Lightsail PostgreSQL に同居させるのか

Graph は durable knowledge の SSOT である。対象は person、org、brand、philosophy、decision、glossary term、promote 済み learning など。日々の SNS posting queue は、それ自体では durable knowledge ではなく operational state である。

draft body の編集、schedule 状態、posted URL、raw metrics、review note を Graph entity として直接持つと、Graph が workflow queue になり、promote 済み knowledge の置き場という役割が崩れる。

一方で、この最初の cockpit のために別ホスティング基盤を増やすと、scale 理由がない段階で運用負荷だけが増える。既存 Lightsail PostgreSQL は candidate-store、integration accounts、Graph 周辺サービスの本番接続先として既に採用方向にある。

## 決定

SNS 投稿運用は、Graph とは別の **SNS Posting Ledger** を使う。

SNS Posting Ledger は Graph SSOT ではない。draft、review、schedule、posting、metrics、learning candidate linkage を保持する operational ledger とする。

Ledger は brainbase production data と同じ Lightsail PostgreSQL infrastructure 上に置く。ただし Graph SSOT tables とは別 table / schema として分離する。

## 境界

### Graph SSOT の責務

Graph は durable knowledge を保持する。

- person / org
- brand / account identity
- philosophy / operating principles
- glossary term
- decision / accepted architecture
- candidate-store approval 後に promote された learning

Graph は次を保持しない。

- draft queue state
- review status
- scheduled datetime
- promotion 前の edited post body
- raw metrics snapshot
- temporary source candidate

### SNS Posting Ledger の責務

Ledger は operational state を保持する。

- generated date / slot
- post body / revisions
- source references
- review 時点の Persona Brain / Graph Check / Quality Gate snapshot
- review status / reviewer actions
- scheduled datetime
- posted URL
- metrics snapshots
- learning candidate references

Ledger は Graph や candidate-store 由来の evidence snapshot を保持してよい。ただし、その snapshot は Graph truth にはならない。

### Candidate-store の責務

投稿結果から再利用可能な learning が生まれた場合、feedback flow は candidate-store learning candidate を作る。

Graph への promotion は ADR-010 の Memory Promotion Kernel 境界を通す。

raw metrics は Graph に直接書き込まない。

## 運用モデル

標準の post state flow は次の通り。

```text
/ohayo review pack
  -> SNS Posting Ledger: review_needed
  -> operator review/edit
  -> approved
  -> scheduled
  -> posted
  -> learning_ready
  -> candidate-store learning candidate
  -> Graph promotion gate
```

MVP では、X 上で手動投稿し、posted URL を brainbase に貼り戻す運用を許容する。X API による full posting は後続の execution layer とし、その場合も同じ Ledger を通す。

## インフラ判断

Ledger は既存 Lightsail PostgreSQL infrastructure を使う。

これは infrastructure co-location の判断であり、data boundary を潰す判断ではない。

- 同じ PostgreSQL host に置いてよい
- 別 table / schema は必須
- Graph table write は promotion 経由に限定する
- repository boundary で accidental Graph write を起きにくくする
- migration は idempotent にする

## 影響

- SNS Cockpit 実装は明確な DB / API 境界から始められる。
- UI は Graph を workflow queue 化せず、calendar / review / schedule / posted 状態を表示できる。
- `/ohayo` は Graph semantics を変えずに review pack を idempotent に保存できる。
- `/oyasumi` は posted record を読んで learning candidate を作れるが、Graph へ直接 mutation しない。
- 将来の X API posting は Ledger 上の execution adapter として追加できる。
- 将来の multi-account / agency workflow は、Graph taxonomy を先に増やさず Ledger model の拡張として扱える。

## 代替案

### 投稿をすべて Graph event entity として保存する

却下。

Graph が workflow queue になり、raw metrics、temporary draft、edited copy が promote 済み knowledge store に混ざる。status churn や edit history も semantic knowledge のように見えてしまう。

### markdown / JSON file を durable store とする

却下。

markdown / JSON artifact は review や debugging には有用だが、calendar query、status transition、idempotency、metrics snapshot、UI editing の durable store としては不足する。

### 別の hosted database を使う

MVP では却下。

最初の version では別 operational infrastructure を正当化する scale 理由がない。schema / table boundary を明示する前提で、Lightsail PostgreSQL で足りる。

### 生成 draft から直接 auto-post する

MVP では却下。

現在の運用方針は「AI が draft し、人間が review し、brainbase が管理する」。full posting automation は後続でよいが、その前に review と ledger state が必要。

## 非目標

- この ADR では物理 SQL schema を定義しない。
- この ADR では calendar UI layout を定義しない。
- この ADR では unattended auto-posting を許可しない。
- この ADR では draft post 用の新しい Graph entity type を追加しない。
- この ADR では multi-account agency support を決めない。

## 検証

実装 story では次を証明する。

- `/ohayo` persistence が date + slot で idempotent である。
- status transition が明示的で testable である。
- Ledger write が Graph table を mutate しない。
- posted URL と metrics snapshot を promotion なしで保存できる。
- learning promotion が candidate-store を通る。
- migration 中も既存 markdown / signals output が動き続ける。
