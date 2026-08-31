---
story_id: story-j0-exact-commit-consumer-build
title: J0 固定commit consumerが公開packageをbuildして利用できる
status: done
category: compatibility
spec: docs/specs/j0-exact-commit-consumer-build.md
architecture: docs/architecture/judgment-dag-core.md
canonical_story_path: docs/management/stories/active/story-j0-exact-commit-consumer-build.md
created_at: 2026-08-31
updated_at: 2026-08-31
---

# J0 固定commit consumerが公開packageをbuildして利用できる

## 利用者成果

組織版SSOTのADR-022に従うconsumerとして、公開済みnpm versionを待たずにOSS repositoryの固定commitをpackage dependencyとしてinstallし、`@unson/brainbase-mcp/judgment-dag`のJ0 APIを利用したい。これによりsource copyや組織版独自実装を作らず、検証対象のOSS revisionを一意に固定できる。

## 受け入れ基準

- [x] AC-001: packageがGit dependencyのinstall lifecycleで`dist`を生成し、公開exportsを変更しない。
- [x] AC-002: fresh consumerが現在commitをexact SHAでinstallし、`@unson/brainbase-mcp/judgment-dag`からartifact APIをimportできる。
- [x] AC-003: tarball consumer smoke、focused test、typecheck、buildが同一HEADでpassする。
- [x] AC-004: npm公開、version変更、deploy、本番変更、組織版source copyを行わない。

## 完了条件

fixed-commit consumer smokeがlock上の同一SHAと公開subpath importをreadbackし、独立レビューでblocking findingがないこと。
