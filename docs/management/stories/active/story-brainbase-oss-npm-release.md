---
story_id: story-brainbase-oss-npm-release
title: CLIから安全に再実行できるBrainbase OSS npm公開
status: active
period: 2026Q3
spec: docs/specs/story-brainbase-oss-npm-release.md
architecture: docs/architecture/story-brainbase-oss-npm-release.md
business_metric: merge済みversionのnpm公開成功率とregistry検証完了率
related_tasks:
  - task_source: VibePro
    task_ids:
      - OSS-NPM-RELEASE-001
pr_scope_strategy: atomic_single_pr
pr_scope_reason: "The release CLI, immutable artifact proof, least-privilege GitHub workflow, package command wiring, dependency audit repair, executable tests, operator documentation, and responsibility contract form one fail-closed publication boundary. Splitting them would temporarily expose a release command or privileged workflow without the exact verification and recovery contract that makes publication safe."
pr_scope_review_facets:
  - repo-control
  - requirements-ssot
  - runtime-behavior
  - misc-follow-up
pr_scope_dependency_boundaries:
  - requirements-ssot->runtime-behavior
  - runtime-behavior->repo-control
  - repo-control->misc-follow-up
created_at: 2026-08-04
updated_at: 2026-08-04
---

# CLIから安全に再実行できるBrainbase OSS npm公開

## 背景

Brainbase OSSは`@unson/brainbase-mcp`として公開可能なpackage構成を持つが、公開手順はREADMEの直接`npm publish`だけで、認証、merge commitとの結び付け、再実行、registry反映確認が一つの経路になっていない。そのため、merge済みでもnpm未公開の状態を見落としやすく、ローカルnpm loginへ依存する。

## 誰が・何を・なぜ

OSS maintainerは、merge済みのpackageをGitHub CLIからpackage単位で直列化されたActionsへdispatchし、公開済みversionが期待するmerge commitと一致することまで確認したい。これにより、mergeをreleaseと誤認せず、失敗した公開を安全に再実行できる。

## 受け入れ基準

- [ ] `npm run release:plan`で2つのgit ref間のpackage version差分を判定できる。
- [ ] `npm run release:publish`は直列化されたupstream Actions内だけで未公開versionを公開し、公開済みなら同じ`gitHead`か検証する。ローカル直接実行は拒否する。
- [ ] 異なるcommitに結び付いた同一versionを成功扱いしない。
- [ ] stableとprereleaseに適切なnpm dist-tagを使い、registry収束を検証する。
- [ ] GitHub Actionsはmerge commitをdetached checkoutし、build、test、production audit、pack確認後に公開する。
- [ ] Actionsの検証jobはread-onlyかつOIDC/npm credentialなしで実行し、公開jobだけへGitHub SecretとOIDCを許可する。
- [ ] 検証jobと実行tarball proofはnpm公開トークン、publication権限、registry mutationなしで再現できる。production auditが使うread-only vulnerability metadata取得はこの境界に含めない。
- [ ] version変更を伴うdevelop向けPR mergeは自動公開され、初回・復旧は手動dispatchできる。
- [ ] 公開完了はnpm metadataのversion、gitHead、`dist.integrity`、dist-tagで証明する。

## 境界

- CLIはnpm registryへのpackage公開だけを扱い、Ontology releaseのGraph公開とは別物とする。
- version bumpはcontributorのPRに残し、release CLIがpackage.jsonを自動変更しない。
- npm organization、2FA、token発行などregistry側の権限設定は自動変更しない。
- GitHub Releaseはnpm公開成功後に作成し、GitHub Releaseだけを公開成功証拠にしない。

## 実行Task

`OSS-NPM-RELEASE-001` は、release CLI、最小権限Actions、実行tarballの同一性検証、運用・ロールバック手順、それらを拘束するテストを1つの公開境界として実装する。workflowだけ、CLIだけ、または検証だけを先行リリースしない。

## Done evidence

release CLIのunit test、workflow contract test、full test、build、production dependency audit、実tarball manifestのgitHeadとSHA-512 integrity検査を現在HEADへ結び付ける。merge後はActions結果に加え、npm registryからversion、gitHead、`dist.integrity`、dist-tagを再取得して完了判定する。
