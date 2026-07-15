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

- GitHub Actions reusable workflow/composite actionが `always()` で起動し、GitHubのrun id/attempt/conclusionをsource authorityとして送る。
- workflow run URLとartifact URLだけをevidence refにし、job logsやsecretを複製しない。
- 各repositoryがManaを経由せずBrainbaseへ直接接続する。

## Acceptance Criteria

- [ ] `github.run_id` と `github.run_attempt` をsource authorityとして読み、`run.external_run_id = "github:" + github.run_id + ":attempt:" + github.run_attempt` とする。rerun attemptは別source runであり、同じattemptのBrainbase送信再試行だけをdelivery retryとして扱う。workflow ref/nameはworkflow identityへ写像する。
- [ ] GitHubのreachable conclusionを次のように決定的にmappingする: `success -> success`、`failure|timed_out|startup_failure -> failed`、`cancelled -> cancelled`、`action_required -> waiting_human`、`skipped|neutral|stale -> blocked`。`blocked`/`failed`はredacted blocker reasonまたはactionを必須とし、未知・null conclusionはsource runの偽successへせず `connector_observation` の `blocked + unconfirmed` として送る。
- [ ] producer step自体が失敗した場合も元workflow conclusionを上書きせず、delivery失敗として再送可能なartifact/dispatch経路へ残す。
- [ ] S2S credentialはGitHub secret/Environmentで最小scope管理し、fork PRや未信頼contextへ公開しない。
- [ ] 対象production workflowへ実wireし、成功・失敗・cancelled canaryがBrainbase InboxとGitHub run URLで照合できる。
- [ ] reusable connectorのcontract fixtureと、既存workflow conclusionを変えないregression testが通る。

## Verification

- `tests/connectors/github-actions-run-receipt.test.js` は同じ `github.run_id` の attempt 1 と attempt 2 が異なる `external_run_id` / idempotency keyで共存し、同じattemptの再送だけがduplicateになるpre-fix失敗fixtureを持つ。
- 同fixtureは `success`、`failure`、`timed_out`、`startup_failure`、`cancelled`、`action_required`、`skipped`、`neutral`、`stale`、未知値、nullを全て検証し、未知値や証拠不足を `success` または空結果へ変換しない。
- producerのdelivery failure fixtureは元workflowのconclusionを変更せず、outbox artifactから同じsource identityで再送できることを検証する。

## Failure Modes

- GitHub API/rate limitでevidenceを取得できない場合はunconfirmed/no_dataを保持する。
- Brainbase 4xxはworkflowを偽成功にせず、connector delivery failureとして明示する。
