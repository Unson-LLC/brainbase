---
name: brainbase-npm-publish
description: Brainbase OSSの@unson/brainbase-mcpをnpmへ公開、検証、監視、復旧する時に使う。共通公開契約はnpm-package-publish Skillを先に読み、このSkillはBrainbase固有値とOIDC公開境界だけを与える。
---

# Brainbase npm Publish Adapter

## Purpose

`npm-package-publish`へBrainbase OSS固有の公開profileを渡す薄いadapter。共通の安全条件、exact-SHA照合、部分失敗、復旧手順はここへ複製しない。

## When to Use

`@unson/brainbase-mcp`のrelease PR、npm公開workflow、registry/GitHub Release照合、部分失敗の復旧に使う。一般的なnpm公開だけなら共通Skillを使う。

## Required Skill

最初に`npm-package-publish`を読む。見つからない場合は公開操作を始めず、brainbase-unsonの`.claude/skills/npm-package-publish`をSkill配布経路から導入する。

## Release Profile

| Key | Value |
|---|---|
| `repository` | `Unson-LLC/brainbase` |
| `package` | `@unson/brainbase-mcp` |
| `default_branch` | `develop` |
| `version_source` | `package.json` |
| `release_workflow` | `.github/workflows/npm-publish.yml` |
| `release_plan` | `npm run release:plan -- --before <base-sha> --after <release-sha>` |
| `targeted_checks` | 下記「Brainbase checks」 |
| `fresh_install_check` | 隔離先へ`@unson/brainbase-mcp@<version>`を導入し、`brainbase onboard:start`を実processで実行 |
| `product_convergence` | validation proof、tarball SHA-256/SHA-512、npm provenance、GitHub Release、CLI実行結果 |

## Brainbase Checks

```bash
npm run build
npm run test:integration:release-evidence
npx vitest run tests/npm-release.test.ts tests/npm-release-workflow.test.ts
npm pack --dry-run
git diff --check
```

公開候補のread-only検証:

```bash
npm run release:validate -- \
  --version <version> \
  --sha <full-release-sha> \
  --trusted-ref upstream/develop \
  --proof-file <outside-repo-path>

npm run release:verify -- --version <version> --sha <full-release-sha>
```

## Required Workflow

1. `npm-package-publish`を読み、このprofileの全keyを渡す。
2. Brainbase checksとread-only validationをcurrent release SHAで実行する。
3. PR merge後の`npm-publish.yml`を同じSHAへ結び付けて監視する。
4. Brainbase Convergenceを照合し、staging tagを含む部分失敗を残す。

## Publication Boundary

- registry mutationは`npm-publish.yml`の直列化されたupstream GitHub Actions内だけで行う。localの`release:publish`で迂回しない。
- workflowはreview済みrelease commitをdetach checkoutし、credentialなしのvalidate jobで作ったimmutable tarballとproofをpublish jobへ渡す。
- publish jobはGitHub OIDC/provenanceとworkflow serialization markerを要求する。callerが設定したActions風環境変数を認証根拠にしない。
- manual recoveryの`release_ref`も`develop`から到達可能なcommitだけを許可する。
- `release:verify`はread-onlyである。dist-tag不一致を修復せず非0で報告する。

## Brainbase Convergence

- npm `version`、`gitHead`、`dist.integrity`をvalidated artifactへ一致させる。
- SemVerから導く正規dist-tagと、公開中だけ使う`release-<sha12>` staging tagを別物として扱う。
- staging tagの削除だけがnpmの権限制約で失敗した場合、package公開は成功済みでもworkflowは部分失敗である。残存tagを明記し、公開全体の成功へ丸めない。
- `refs/tags/v<version>`とGitHub Release targetをrelease SHAへ一致させる。
- fresh installはlocal tarballではなくregistry版を隔離先へ導入し、`brainbase --help`と`brainbase onboard:start --dir <isolated-dir>`を実行する。
- VitePressはpackage publicationの完了条件ではない。README/docsの公開手順が変わった場合は別のdocs build/deploy証拠として報告する。

## Repository Boundary

このrepoは外部向けPersonal Onboarding Kitである。internal server、Graph SSOT、Infisical、組織routineを公開Skillへ持ち込まない。対象checkoutの`AGENTS.md`を優先する。

## Common Rationalizations

- 「workflowがpackageをpublishしたので全て完了」: staging tag、GitHub Release、fresh installを別に確認する。
- 「staging tag削除だけの失敗は無視できる」: package利用可否とworkflow収束状態を分けて報告する。

## Red Flags

- localから`release:publish`を実行してOIDC境界を迂回している。
- validated tarballとnpm `dist.integrity`を照合していない。
- local tarballのCLI実行をregistry版fresh installの証拠にしている。

## Verification

frontmatter、必須section、profile key、共通Skill参照、記載コマンドの存在、`git diff --check`を検証する。実公開時は共通Skillの外部照合とBrainbase Convergenceを両方満たす。
