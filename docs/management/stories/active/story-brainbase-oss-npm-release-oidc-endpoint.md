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
created_at: 2026-08-04
updated_at: 2026-08-04
---

# GitHub regional OIDC endpointでOSS npm公開を継続する

## 背景

初回のOSS npm公開workflowは、GitHub-hosted runnerが返したregional OIDC endpoint
`pipelinesghubeus4.actions.githubusercontent.com`を、canonical hostnameだけを許可する実装で拒否した。
workflow、repository、run、refのOIDC claim検証は成功する前に停止し、npm registry mutationは発生しなかった。

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

## Done evidence

現在HEADに結び付いたunit、integration、E2E、buildと独立レビューでマージ可否を決める。merge後は元Story `story-brainbase-oss-npm-release` のAC-9としてnpm metadataとGitHub Releaseを検証する。
