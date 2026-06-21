---
title: Meeting Workflow Pack Cockpit UI Architecture
story_id: story-meeting-workflow-pack-cockpit-ui-v1
status: active
created_at: 2026-06-21
updated_at: 2026-06-21
---

# Meeting Workflow Pack Cockpit UI Architecture

## 位置づけ

`/workflows` は Workflow Mission Control の横断 inbox であり、全 project の action required、human waiting、failed、recent run を扱う。

`/meeting-workflow-pack.html` は Meeting Workflow Pack の専用 Cockpit である。Role Agent が workflow を選び、会議から生まれたタスク / 決定事項 / フォローアップの人間確認をさばき、Brainbase に戻る証跡を確認するための画面とする。zip prototype の構造を維持しつつ、実運用で迷わないよう表示文言は日本語に寄せる。

```mermaid
flowchart LR
  user["人間オペレーター"] --> cockpit["Meeting Workflow Pack Cockpit"]
  workflows["/workflows<br/>Workflow Mission Control"] --> cockpit
  cockpit --> prototype["Promoted zip prototype<br/>meeting-workflow-pack.dc.html"]
  prototype --> localState["Prototype Local State<br/>review / run / definition / agent"]
  cockpit --> localState["Local HITL State<br/>承認 / 差し戻し / 編集"]
  localState -. "v1: 書き戻さない" .-> taskStore["Task Store"]
  localState -. "v1: 昇格しない" .-> graph["Graph SSOT"]
  localState -. "v1: 外部送信しない" .-> external["Slack / Gmail"]
```

## UI構造

zip prototype の構造を採用する。今回の目的は画面再現と実利用時の理解しやすさの両立であり、`public/meeting-workflow-pack.html` は prototype の layout / marker / interaction を維持しつつ日本語表示へ変換する。runtime は `public/support.js` として同一内容を配信する。

- Header: `業務ループ制御`、組織切替、担当エージェント切替、承認待ち count。
- Left Rail: `対応` と `参照`。
- Overview: 会議業務エージェントの説明、metrics、会議ライフサイクル。
- Review Queue: 人間確認が必要な候補の一覧。
- Review Detail: 候補選択、編集、差し戻し、承認。
- Run Trace: 入力元、議事録要約、書き戻し状態、監査証跡。
- Stub Agents: 営業 / バックオフィス / マーケティングの未構築 agent shell。

## データ投影

このStoryでは実データ投影を行わない。zip prototype の local state をそのまま使い、以下を再現する。

| Prototype State | Cockpit projection |
|---|---|
| `ORGS` | Instance menu |
| `AGENTS` | Role Agent menu / stubs |
| `WF` | Workflow Definition cards |
| `RUNS` | Review Queue / Run Trace |
| `steps` | approve / reject local state |
| `excl` / `edits` / `reason` | review detail editing state |

Workflow Control API 接続は次Storyで扱う。その際も、今回再現した header、left rail、review queue、review detail、run trace、stub agent の画面構造と日本語表示を壊さない。

## State Machine

```mermaid
stateDiagram-v2
  [*] --> Loading
  Loading --> ReviewQueue: DC runtime booted
  Overview --> ReviewQueue: 承認待ちを開く
  Overview --> Definition: ワークフロー定義を開く
  ReviewQueue --> ReviewDetail: 確認対象を選ぶ
  ReviewDetail --> ApprovedLocal: 画面内で承認
  ReviewDetail --> RejectedLocal: 差し戻し
  ApprovedLocal --> ReviewQueue
  RejectedLocal --> ReviewQueue
  Overview --> RunTrace: 実行履歴を開く
  RunTrace --> ReviewDetail: 承認待ちを開く
```

## 安全境界

v1 の承認操作は local UI state のみである。次の副作用は実行しない。

- Task Store への task 作成。
- Graph SSOT への Decision 昇格。
- Slack / Gmail への外部送信。

高リスクの `決定事項の昇格` と `フォローアップ送信` には確認 checkbox を表示し、実 write-back ではないことを明示する。
