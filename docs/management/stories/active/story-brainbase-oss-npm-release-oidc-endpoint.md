---
story_id: story-brainbase-oss-npm-release-oidc-endpoint
title: GitHub regional OIDC endpointでOSS npm公開を継続する
status: active
period: 2026Q3
horizon: quarter
view: business
category: product
spec: docs/specs/story-brainbase-oss-npm-release-oidc-endpoint.md
architecture: docs/architecture/story-brainbase-oss-npm-release-oidc-endpoint.md
business_metric: regional GitHub-hosted runnerでのpublication context検証成功率
related_tasks:
  - task_source: VibePro
    task_ids:
      - story-brainbase-oss-npm-release-oidc-endpoint-source-alignment-review
pr_scope_strategy: atomic_single_pr
pr_scope_reason: "The hostname predicate and its positive and negative regression tests form one fail-closed trust-boundary correction."
pr_scope_review_facets:
  - requirements-ssot
  - runtime-behavior
pr_scope_dependency_boundaries:
  - requirements-ssot->runtime-behavior
created_at: 2026-08-04
updated_at: 2026-08-04
---

# GitHub regional OIDC endpointでOSS npm公開を継続する

## 背景

初回のOSS npm公開workflowは、GitHub-hosted runnerが返したregional OIDC endpoint
`pipelinesghubeus4.actions.githubusercontent.com`を、canonical hostnameだけを許可する実装で拒否した。
workflow、repository、run、refのOIDC claim検証は成功する前に停止し、npm registry mutationは発生しなかった。

## Current reality

失敗run `30881013519`では、immutable commitのvalidationまでは成功し、publish jobがGitHub-hosted runnerのregional OIDC endpointを信頼できずに停止した。したがって現在のblockerはnpm credentialやregistry mutationではなく、token取得前のendpoint authority判定である。hotfixはこの失敗経路をunit testでreplayし、既存claim検証へ進む境界だけを修正する。

## 誰が・何を・なぜ

OSS maintainerは、GitHub Actionsが発行するcanonicalまたはregional pipeline endpointからのみOIDC tokenを取得し、既存のclaim検証を維持したままnpm公開を再実行したい。

## Business contextと成功指標

初回OSS公開を止めているproduction release blockerを、registryの安全境界を弱めずに解消する。PR内の成功指標はregional endpointのpositive testとlookalike endpointのnegative testが現在HEADで成功すること、merge後の運用指標はpublication context検証を通過して元Storyのregistry検証まで到達することとする。

## 受け入れ基準

- [ ] `pipelines.actions.githubusercontent.com`と、`pipelines`で始まるGitHub regional hostnameを許可する。
- [ ] endpointはHTTPS、portなし、userinfoなし、正確な`.actions.githubusercontent.com` suffixに限定する。
- [ ] suffixの後ろへ攻撃者domainを付けたlookalike hostnameを公開前に拒否する。
- [ ] audience、repository、run ID、workflow ref、ref claimの既存検証を緩めない。
- [ ] regional endpoint成功とlookalike拒否をunit testで固定し、release validation、E2E、buildが現在HEADで成功する。

## 境界

- npm token、npm organization、GitHub repository設定は変更しない。
- 公開workflowやartifact contractは変更しない。
- npm registryへの実公開はmerge後の手動dispatchで検証し、このhotfixのPR前Gateには循環条件として含めない。

## Failure modes

- malformed、HTTP、port付き、userinfo付き、lookalike suffixのendpointを誤って許可すること。
- regional endpointを再び拒否し、workflowをtoken取得前で停止させること。
- endpoint修正に伴い、audience、repository、run ID、workflow ref、ref claimの検証を緩めること。

これらはfocused unit testのpositive/negative path、release validation、OSS E2E、buildで現在HEADに結び付ける。

## Release note / operator action

Release note: GitHub-hosted runnerのregional pipelines OIDC endpointを、HTTPS・authority・suffixの制約を維持したまま受け入れる。利用者向けCLIやpackage APIの変更はない。

merge後のoperator actionは、`develop`を`release_ref`に指定して`npm-publish.yml`を手動dispatchすること。observability evidenceはGitHub Actionsのvalidation/publish各job logと、公開後に取得するnpm metadataの`version`、`gitHead`、`dist.integrity`、dist-tag、GitHub Releaseとする。

Rollback instruction: 公開前に問題が見つかった場合はhotfix commitをrevertしてworkflowを再実行しない。公開後のnpm versionはimmutableなので削除や上書きをせず、修正版を新しいforward versionとして公開する。

## Done evidence

現在HEADに結び付いたunit、integration、E2E、buildと独立レビューでマージ可否を決める。merge後は元Story `story-brainbase-oss-npm-release` のAC-9としてnpm metadataとGitHub Releaseを検証する。
