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

- [ ] `github.run_id` をexternal run identity、workflow ref/nameをworkflow identityとして決定的なreceiptを生成する。rerun attemptは同一source runのdelivery retryか別runかをGitHub semanticsに基づき仕様固定する。
- [ ] success/failure/cancelled/skipped/action-required相当を、未定義状態を成功扱いせずmappingする。
- [ ] producer step自体が失敗した場合も元workflow conclusionを上書きせず、delivery失敗として再送可能なartifact/dispatch経路へ残す。
- [ ] S2S credentialはGitHub secret/Environmentで最小scope管理し、fork PRや未信頼contextへ公開しない。
- [ ] 対象production workflowへ実wireし、成功・失敗・cancelled canaryがBrainbase InboxとGitHub run URLで照合できる。
- [ ] reusable connectorのcontract fixtureと、既存workflow conclusionを変えないregression testが通る。

## Failure Modes

- GitHub API/rate limitでevidenceを取得できない場合はunconfirmed/no_dataを保持する。
- Brainbase 4xxはworkflowを偽成功にせず、connector delivery failureとして明示する。

