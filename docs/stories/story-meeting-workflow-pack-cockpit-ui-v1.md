---
story_id: story-meeting-workflow-pack-cockpit-ui-v1
title: Meeting Workflow Pack Cockpit UI v1
status: active
created_at: 2026-06-21
updated_at: 2026-06-21
architecture_docs:
  - docs/architecture/meeting-workflow-pack-cockpit-ui-architecture.md
spec_docs:
  - docs/specs/story-meeting-workflow-pack-cockpit-ui-v1-spec.md
source_design:
  - docs/design/prototypes/meeting-workflow-pack/meeting-workflow-pack.dc.html
---

# Meeting Workflow Pack Cockpit UI v1

## 背景

Meeting Workflow Pack v0 は、既存 `/workflows` の Agent Loop Control パネル内に Meeting Pack の定義と接続状態を投影した。しかし、zip で渡された画面の主眼は小さなパネルではなく、Role Agent が会議業務ループを選び、承認待ちをさばき、run trace と write-back を確認する専用 Cockpit だった。

この Story では、zip の `AGENT LOOP CONTROL` 画面を Brainbase 上で試せる画面として再現する。既存 Workflow Mission Control を置き換えず、Meeting Workflow Pack の利用体験を確認するための専用 surface とする。

## User Story

Brainbase operator として、Mana の会議業務ループを `Meeting Ops Agent` の Cockpit として見たい。そうすることで、会議予定、議事録、Task 候補、Decision 候補、Follow-up 文面、承認、証跡、次回会議への反映が、単なる設定一覧ではなく一つの業務ループとして見える。

## Scope

- `/meeting-workflow-pack.html` に zip prototype 相当の Agent Loop Control Cockpit を追加する。
- `/workflows` の Meeting Workflow Pack パネルから Cockpit へ遷移できるようにする。
- Cockpit は既存 Workflow Control API から Role Agent / Workflow Template / Binding / Trigger / Loop Intent を読む。
- API が空または未接続でも、Meeting Pack の定義と human gate のデモ構造は決定的 fallback で表示する。
- Approve / Reject は v1 では画面内状態だけを更新し、Graph SSOT、Task Store、外部送信には書き込まない。

## Acceptance Criteria

- [ ] ac:1 `/meeting-workflow-pack.html` は zip prototype の黒い `AGENT LOOP CONTROL` header、Instance / Role Agent 切替、承認待ち badge を持つ。
- [ ] ac:2 左 rail は `対応 · OPERATE` と `リファレンス · REFERENCE` に分かれ、承認待ち、進行中 runs、Workflow Definitions を表示する。
- [ ] ac:3 Workflow Definitions は `SCHEDULE`、`EVENT`、`HUMAN` の trigger lane に分かれ、5つの会議 workflow を表示する。
- [ ] ac:4 main overview は `Meeting Ops Agent`、会議ライフサイクル、definitions / instances / 承認待ち metrics を表示する。
- [ ] ac:5 Review Queue は `Tasks 作成`、`Decisions 昇格`、`Follow-up 送信` の human gate を risk と write-back target 付きで表示する。
- [ ] ac:6 Review Detail は候補の選択、本文編集、差し戻し理由、高リスク承認チェックを画面内状態として扱える。
- [ ] ac:7 Run Trace は meeting source、note summary、Task / Decision / Follow-up の write-back status、audit evidence を一画面で確認できる。
- [ ] ac:8 Sales / Back-office / Marketing Agent は未構築 stub として表示し、Role Agent を横展開する画面構造を示す。
- [ ] ac:9 `/workflows` の Meeting Workflow Pack パネルから Cockpit へリンクできる。
- [ ] ac:10 E2E は zip prototype の主要構造 marker と Review Queue / Review Detail の interaction を検証する。

## Out of Scope

- 実際の Task Store 作成。
- Graph SSOT Decision 昇格。
- Slack / Gmail への外部送信。
- Eve runner の実接続。
- zip prototype の Decap runtime そのものの埋め込み。

## Risk

- `Workflow Mission Control` と `Meeting Workflow Pack Cockpit` の責務が混ざると、全体監視画面と会議業務専用画面の境界が曖昧になる。
- Approve ボタンが実 write-back のように見えると危険なので、v1 は画面内状態であることを UI 上に明示する。
- Graph SSOT に落とし込めない候補を正本化済みのように見せない。
