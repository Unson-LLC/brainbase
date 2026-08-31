---
title: J0 固定commit consumer build契約仕様
status: accepted
story_id: story-j0-exact-commit-consumer-build
architecture: docs/architecture/judgment-dag-core.md
date: 2026-08-31
---

# J0 固定commit consumer build契約仕様

## 契約

`package.json`の`prepare`は既存の`npm run build`だけを呼び出す。Git dependencyとして取得されたpackageは、install中にTypeScript sourceから既存exportsが参照する`dist`を生成する。

consumer smokeはfresh directoryへ現在のGit SHAをexact dependencyとしてinstallし、lockfileのresolved revisionが同一SHAであることと、`./judgment-dag`から`saveJudgmentDAGRunArtifact`をimportできることを確認する。

## 境界

- package version、exports、runtime semantics、artifact contractは変更しない。
- `dist`をGitへcommitしない。
- npm publish、registry readback、deploymentは行わない。
- 組織版のexact SHA pinとsave/reload smokeは後続consumer changeで実施する。

## 検証

1. `prepare`宣言のfocused contract test。
2. exact current commitをinstallするfresh consumer integration test。
3. 既存npm tarball consumer smoke。
4. typecheck、build、独立レビュー。
