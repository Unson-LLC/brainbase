---
story_id: story-brainbase-oss-npm-release-oidc-endpoint
title: GitHub Actions OIDC endpoint判定を実測に合わせて復旧する
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
pr_scope_reason: "Run 30893794741 isolated the hostname predicate failure. The runtime trust-boundary correction, direct tests, release-evidence command, workflow enablement, acceptance replay, and operator runbook must land together so publication cannot be enabled before its validating runtime and evidence path."
pr_scope_review_facets:
  - repo-control
  - requirements-ssot
  - runtime-behavior
  - e2e-gate
  - misc-follow-up
pr_scope_dependency_boundaries:
  - requirements-ssot->runtime-behavior
  - requirements-ssot->misc-follow-up
  - runtime-behavior->repo-control
  - runtime-behavior->e2e-gate
  - repo-control->e2e-gate
created_at: 2026-08-04
updated_at: 2026-08-04
---

# GitHub Actions OIDC endpoint判定を実測に合わせて復旧する

## 背景

診断run [`30893794741`](https://github.com/Unson-LLC/brainbase/actions/runs/30893794741) は、秘密値を出さずに `url_present=true`、`parse_ok=true`、`protocol_https=true`、`hostname_trusted=false`、`raw_authority_colon=false`、`userinfo_present=false`、`normalized_nondefault_port=false` を記録し、OIDC request前に停止した。これにより、明示的`:443`仮説は棄却され、`pipelines` prefixだけを許すhostname predicateがproduction blockerだと確定した。

## Current reality

診断runではimmutable commit `a84fce233eb98ce12f6ee06f710ee78deecc2f42`のvalidationとartifact transferが成功し、publish jobだけがhostname判定で安全に停止した。修正はGitHub管理下の単一label `*.actions.githubusercontent.com`だけをHTTPS endpointとして許可し、suffix lookalike、userinfo、明示portは引き続き拒否する。token取得後は公式issuer `https://token.actions.githubusercontent.com`、audience、repository、run ID、workflow ref、refを完全一致で検証する。さらにnpm Trusted Publishingの公式要件に合わせ、publish jobのnpm CLIを`11.5.1`へ固定し、診断フラグを削除する。

## 誰が・何を・なぜ

OSS maintainerは、実測で確認したGitHub Actions提供endpoint classを安全に通し、OIDC claimを完全一致で検証したうえで、CLIから初回npm公開を完了したい。

## Business contextと成功指標

初回OSS公開を止めているproduction release blockerを実測根拠で解消する。PR内の成功指標は、非`pipelines` GitHub endpointのpositive test、suffix lookalike・userinfo・portのnegative test、issuerを含むclaim test、診断フラグ削除、npm CLI要件のworkflow testが現在HEADで成功すること。merge後はnpm metadataとGitHub Releaseの一致を成功指標とする。

## 受け入れ基準

- [ ] 診断出力を`url_present`、`parse_ok`、`protocol_https`、`hostname_trusted`、`raw_authority_colon`、`userinfo_present`、`normalized_nondefault_port`の固定booleanへ限定する。
- [ ] URL全文、path、query、OIDC request token、username、passwordの値を出力しない。
- [ ] 診断モードはOIDC requestより前に専用errorで必ず停止し、npm registry mutationへ進まない。
- [ ] HTTPSの単一label `*.actions.githubusercontent.com`を許可し、suffix lookalike、userinfo、明示portを拒否する。
- [ ] OIDC tokenのissuerを公式`https://token.actions.githubusercontent.com`へ固定し、既存claim検証を維持する。
- [ ] 固定diagnostic flagを削除し、publish jobでnpm CLI `11.5.1`を使う。
- [ ] focused unit、workflow、release validation、E2E、buildを現在HEADで成功させる。
- [ ] 初回公開前の責任契約は対象versionのregistry不存在を要求し、公開後はdist integrityとimmutable gitHead一致を要求する。

## 境界

- npm token、npm organization、GitHub repository設定は変更しない。
- artifact contractとregistry mutation順序は変更しない。endpoint hostname class、issuer claim、npm CLI runtimeだけを修正する。
- 診断classifierは安全な再調査用として残すが、workflowの固定diagnostic flagは削除して通常publicationを再開する。

## Failure modes

- 診断メッセージへURL、path、query、tokenまたはuserinfo値を含めること。
- 診断モードがOIDC requestやregistry mutationへ進むこと。
- 診断classifierと現行predicateの式がずれ、原因を誤判定すること。
- 診断追加に伴い通常モードのendpointまたはclaim検証を緩めること。

これらはfocused unit testのpositive/negative path、release validation、OSS E2E、buildで現在HEADに結び付ける。

## User Action

Release note: production診断で特定したGitHub Actions OIDC hostname判定を修正し、公式issuer検証とnpm Trusted Publishing対応CLIを追加する。利用者向けpackage APIの変更はない。

このcorrection PRのmerge後、release ownerは`develop`を`release_ref`に指定して`npm-publish.yml`を一度だけ手動dispatchする。成功時は`@unson/brainbase-mcp@0.1.0`のversion、gitHead、dist integrity、dist-tagとGitHub Release `v0.1.0`のtarget commitを照合する。失敗時は同じrunを証拠として、公開済みversionの有無を確認してから再調査する。

Rollback instruction: endpoint判定またはclaim検証に問題があればcorrection commitをrevertし、workflowを再実行せず公開停止を維持する。公開後のnpm versionはimmutableなので削除や上書きをせず、修正版を新しいforward versionとして公開する。

## Done evidence

現在HEADに結び付いたunit、integration、E2E、buildと独立レビューでcorrectionのマージ可否を決める。診断runのboolean vectorとrun URLは原因証跡として保存済み。merge後、元Story `story-brainbase-oss-npm-release` のAC-9としてnpm metadataとGitHub Releaseを検証する。
