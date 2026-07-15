---
story_id: story-github-actions-run-receipt-production-connector-v1
title: GitHub Actions production run receipt connector v1
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
runtime_owner: github_actions
---

# GitHub Actions production run receipt connector v1

## User Story

GitHub Actions operatorとして、対象repositoryの実workflow run conclusionをBrainbaseへ直接送信したい。なぜなら、CI/CDのfailure・cancelled・手動承認待ち・証跡不足をrepositoryごとに巡回せず確認したいから。

## Outcome

- GitHub Actionsの `workflow_run: completed` producer（または同等に最終workflow-run conclusionを取得できる外部poller）が、GitHubのrun id/attempt/conclusionをsource authorityとして送る。元workflow内の `always()` stepが読めるjob/step結果を最終workflow conclusionの代用にしない。
- workflow run URLとartifact URLだけをevidence refにし、job logsやsecretを複製しない。
- 各repositoryがManaを経由せずBrainbaseへ直接接続する。

## Acceptance Criteria

- [ ] `github.repository_id`、`github.run_id`、`github.run_attempt` をsource authorityとして読み、`source.workflow_id = "github:" + repository_id + ":workflow:" + workflow_id_or_path`、`run.external_run_id = "github:" + repository_id + ":run:" + run_id + ":attempt:" + run_attempt` とする。rerun attemptは別source runであり、同じattemptのBrainbase送信再試行だけをdelivery retryとして扱う。同じBrainbase project内の2 repositoryが同じ数値run id、attempt、workflow名を持つcross-repository fixtureでも衝突しない。
- [ ] producerは `workflow_run: completed`、webhook、または外部pollerでauthoritative terminal conclusion確定後に起動する。既知のqueued/in_progress/null conclusionはdeferし、completed eventでそのattemptのsource receiptを1件だけ作る。
- [ ] GitHubのreachable terminal conclusionを下表どおり決定的にmappingする。既知のrepository/run/attemptに対する未知・null conclusionはconnector outboxでpendingのまま再観測し、source receiptも `connector_observation` も送らない。run identity自体を取得できない観測失敗だけを、connector-owned observation attempt idを持つ `connector_observation` の `blocked + unconfirmed|no_data` として送る。
- [ ] producer step自体が失敗した場合も元workflow conclusionを上書きせず、delivery失敗として再送可能なartifact/dispatch経路へ残す。
- [ ] S2S credentialはGitHub secret/Environmentで最小scope管理し、fork PRや未信頼contextへ公開しない。
- [ ] 対象production workflowへ実wireし、成功・失敗・cancelled canaryがBrainbase InboxとGitHub run URLで照合できる。
- [ ] reusable connectorのcontract fixtureと、既存workflow conclusionを変えないregression testが通る。

## Status / Evidence Mapping

| GitHub conclusion | Receipt status | Evidence state | Action / blocker |
|---|---|---|---|
| `success` | `success` | run URL確認済みなら`confirmed`、参照取得不能なら`unconfirmed` | `none` |
| `failure|timed_out|startup_failure` | `failed` | 上記と同じ | `check_error`とredacted blocker |
| `cancelled` | `cancelled` | 上記と同じ | `none` |
| `action_required` | `waiting_human` | 上記と同じ | `review_run` |
| `stale` | `blocked` | 上記と同じ | `retry_run`とredacted blocker |
| `skipped|neutral`でpolicy-intended non-actionableと確認済み | `success` | `confirmed` | `none`、summaryでno-opを明示 |
| `skipped|neutral`で意図を確認不能または介入根拠あり | `blocked` | `unconfirmed|no_data` | `review_run`とredacted blocker |
| identity既知、conclusion不明/非terminal | receiptなし | connector pending | 再観測 |
| identity不明 | `connector_observation`の`blocked` | `unconfirmed|no_data` | `check_error`または`reauthorize`とblocker |

`no_data` はworkflow件数0や成功を意味しない。

## Verification

- `tests/connectors/github-actions-run-receipt.test.js` は同じrepository/run idのattempt 1/2が異なる `external_run_id` / idempotency keyで共存し、同じattemptの再送だけがduplicateになるpre-fix失敗fixtureを持つ。同じBrainbase project内の2 repositoryが同じ数値run id/attempt/workflow名を持っても共存する。
- 同fixtureは `success`、`failure`、`timed_out`、`startup_failure`、`cancelled`、`action_required`、`skipped`、`neutral`、`stale`、未知値、nullを全て検証する。既知attemptの未知値/nullはconnector内部のpending stateへ留まりreceiptを作らず、identity取得不能だけがsynthetic observationを作り、後から取得したsource receiptとidentity conflictせず共存する。どちらも `success` または空結果へ変換しない。
- 同fixtureは既知attemptの `conclusion=null` eventではreceiptを0件のままdeferし、後続 `workflow_run: completed` でsource receiptを1件作り、completed eventの再配信をduplicateとして扱う。
- producerのdelivery failure fixtureは元workflowのconclusionを変更せず、outbox artifactから同じsource identityで再送できることを検証する。

## Failure Modes

- GitHub API/rate limitでevidenceを取得できない場合はunconfirmed/no_dataを保持する。
- Brainbase 4xxはworkflowを偽成功にせず、connector delivery failureとして明示する。
