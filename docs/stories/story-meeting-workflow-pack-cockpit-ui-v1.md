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

この Story では、zip の `AGENT LOOP CONTROL` 画面構造を Brainbase 上で試せる画面として再現し、実利用時に理解しやすい日本語表示へ寄せる。既存 Workflow Mission Control を置き換えず、Meeting Workflow Pack の利用体験を確認するための専用 surface とする。

## User Story

Brainbase operator として、Mana の会議業務ループを `会議業務エージェント` の Cockpit として日本語で見たい。そうすることで、会議予定、議事録、タスク候補、決定事項候補、フォローアップ文面、承認、証跡、次回会議への反映が、単なる設定一覧ではなく一つの業務ループとして見える。

## Scope

- `/meeting-workflow-pack.html` に zip prototype 相当の Agent Loop Control Cockpit を追加する。
- `/workflows` の Meeting Workflow Pack パネルから Cockpit へ遷移できるようにする。
- Cockpit は zip prototype のレイアウト / interaction を維持しつつ、表示文言は日本語で理解できる状態にする。
- Workflow Control API 接続は次Storyで扱い、このStoryでは prototype の state / interaction を壊さない。
- Approve / Reject は v1 では画面内状態だけを更新し、Graph SSOT、Task Store、外部送信には書き込まない。

## Acceptance Criteria

- [ ] ac:1 `/meeting-workflow-pack.html` は zip prototype 由来の黒い header を維持しつつ、`業務ループ制御`、組織切替、担当エージェント切替、承認待ち badge を日本語で表示する。
- [ ] ac:2 左 rail は `対応` と `参照` に分かれ、承認待ち、進行中 run、ワークフロー定義を日本語で表示する。
- [ ] ac:3 ワークフロー定義は `時間起点`、`イベント起点`、`人間起点` の trigger lane に分かれ、5つの会議 workflow を日本語で表示する。
- [ ] ac:4 main overview は `会議業務エージェント`、会議ライフサイクル、定義 / 組織 / 承認待ち metrics を表示する。
- [ ] ac:5 Review Queue は `タスク作成`、`決定事項の昇格`、`フォローアップ送信` の人間確認をリスクと書き戻し先付きで表示する。
- [ ] ac:6 Review Detail は候補の選択、本文編集、差し戻し理由、高リスク承認チェックを画面内状態として扱える。
- [ ] ac:7 Run Trace は会議入力元、議事録要約、タスク / 決定事項 / フォローアップの書き戻し状態、監査証跡を一画面で確認できる。
- [ ] ac:8 営業 / バックオフィス / マーケティングエージェントは未構築 stub として表示し、Role Agent を横展開する画面構造を示す。
- [ ] ac:9 `/workflows` の Meeting Workflow Pack パネルから Cockpit へリンクできる。
- [ ] ac:10 E2E は zip prototype 由来の主要構造 marker、日本語表示、Review Queue / Review Detail の interaction を検証する。

## Out of Scope

- 実際の Task Store 作成。
- Graph SSOT Decision 昇格。
- Slack / Gmail への外部送信。
- Eve runner の実接続。
- Workflow Control API との実データ同期。

## Risk

- `Workflow Mission Control` と `Meeting Workflow Pack Cockpit` の責務が混ざると、全体監視画面と会議業務専用画面の境界が曖昧になる。
- Approve ボタンが実 write-back のように見えると危険なので、v1 は画面内状態であることを UI 上に明示する。
- Graph SSOT に落とし込めない候補を正本化済みのように見せない。
