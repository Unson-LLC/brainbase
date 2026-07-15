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
- [ ] automation idと実run identityから決定的なreceiptを作り、completed/failed/cancelled/waiting-human相当を明示的にmappingする。
- [ ] connector checkpointは最後にreceipt確認済みのrunを保持し、再起動後も欠落・二重createなくcatch upする。
- [ ] Codex task本文、terminal transcript、prompt、secretをreceiptへ含めない。
- [ ] state DB/APIを読めない場合はconnector observationを作り、runなしや0件成功にしない。
- [ ] 実automation canaryの完了・失敗各1件がBrainbase Inboxとsource stateで照合できる。

## Failure Modes

- schema/version driftはblocked observationと診断ログを残し、未知状態をsuccessへfallbackしない。
- Brainbase timeout/5xxはローカルoutboxで再送し、4xxは要修正として隔離する。
