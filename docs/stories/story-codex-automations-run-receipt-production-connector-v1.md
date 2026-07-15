---
story_id: story-codex-automations-run-receipt-production-connector-v1
title: Codex Automations production run receipt connector v1
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
implementation_repo: /Users/ksato/workspace/code/brainbase
runtime_owner: local_codex
---

# Codex Automations production run receipt connector v1

## User Story

Codex Automations operatorとして、実際のautomation実行結果をBrainbaseへ自動集約したい。なぜなら、taskが未実行・失敗・人間待ち・証拠未確認のどれかをローカルtask一覧だけに依存せず判断したいから。

## Outcome

- Codexの実automation/run stateをsource authorityとして読み、ローカルconnectorからBrainbaseへ直接送る。
- task本文や会話transcriptは送らず、automation id、run id、status、時刻、artifact/task referenceだけを送る。
- ローカルruntimeが停止して観測できない状態を0件として報告しない。

## Acceptance Criteria

- [ ] 現行Codex automation stateの正規保存先/APIをlive inspectionで確定し、推測したファイル形式へ依存しない。
- [ ] live inspectionで確定したauthorityから `source.workflow_id = "codex_automation:" + automation_id`、`run.external_run_id = "codex_automation:" + automation_id + ":run:" + native_run_id + ":attempt:" + native_attempt` を作る。attemptを持たないauthorityは1を固定し、source-defined rerunだけが別receipt、同じattemptの再送はdelivery retryになる。
- [ ] terminal stateは `completed|success -> success`、`failed|timed_out -> failed`、`blocked -> blocked`、`waiting_human|requires_action -> waiting_human`、`cancelled -> cancelled` と決定的に変換する。既知runのrunning/unknown/nullはcheckpoint/outboxでpendingのまま再観測し、state authorityを読めずrun identity自体を得られない場合だけconnector observationを作る。
- [ ] connector checkpointは最後にreceipt確認済みのrunを保持し、再起動後も欠落・二重createなくcatch upする。
- [ ] Codex task本文、terminal transcript、prompt、secretをreceiptへ含めない。
- [ ] state DB/APIを読めない場合はconnector observationを作り、runなしや0件成功にしない。
- [ ] 実automation canaryの完了・失敗各1件がBrainbase Inboxとsource stateで照合できる。

## Failure Modes

- schema/version driftはblocked observationと診断ログを残し、未知状態をsuccessへfallbackしない。
- Brainbase timeout/5xxはローカルoutboxで再送し、4xxは要修正として隔離する。

## Verification

- `tests/connectors/codex-automations-run-receipt.test.js` は同じautomation/native runのattempt 1/2が別identityで共存し、同じattemptの再送だけがduplicateになるpre-fix失敗fixtureを持つ。
- 同fixtureは全terminal mapping、known-run pending、identity取得不能observation、checkpoint再起動catch-up、outbox replay、task/prompt/transcript排除を検証する。
