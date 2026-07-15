---
story_id: story-mana-run-receipt-production-connector-v1
title: Mana production run receipt connector v1
status: proposed
created_at: 2026-07-15
updated_at: 2026-07-15
horizon: quarter
view: business
period: 2026Q3
depends_on:
  - story-cross-runtime-run-receipt-inbox-v1
related_stories:
  - story-cross-runtime-run-receipt-inbox-v1
implementation_repo: /Users/ksato/workspace/projects/mana
---

# Mana production run receipt connector v1

## User Story

Mana operatorとして、Lambda・self-hosted runner上で実際に完了したMana workflowの結果をBrainbaseへ自動送信したい。なぜなら、Manaの成功・失敗・停止・証跡不足をCloudWatchや個別runnerへ巡回せずAgent Run Inboxで判断したいから。

## Outcome

- Manaを4ソースのhubにせず、自身のrunだけを直接 `run_receipt.v1` でBrainbaseへ送る。
- 実run id、最終status、件数metric、CloudWatch/GitHub artifact refをsource-owned evidenceとして使う。
- delivery障害はMana outboxで再送し、source run statusを書き換えない。

## Acceptance Criteria

- [ ] `source.type=mana` と実workflow/run identityを使い、成功・失敗・blocked・waiting human・cancelledを変換できる。
- [ ] production Lambdaとself-hosted runnerの双方からBrainbase S2S endpointへ認証接続できる。secretはInfisical/既存正規経路で供給し、ログへ出さない。
- [ ] 同一run再送は同じidempotency keyとなり、delivery attemptだけが増える。
- [ ] source API/Brainbase到達不能は永続outboxへ残り、次回再送される。source run identityを得られない場合だけconnector observationを送る。
- [ ] raw Slack本文、議事録本文、customer content、CloudWatch log本文をreceiptへ含めない。
- [ ] production canary runがBrainbase Inboxに表示され、Mana側run/evidenceと双方向に照合できる。

## Failure Modes

- 認証不備、timeout、5xxはdelivery failureとして再送対象にする。
- 4xx contract errorは自動無限再送せずblocked outboxとして可視化する。
- no_dataを処理件数0のsuccessへ変換しない。
