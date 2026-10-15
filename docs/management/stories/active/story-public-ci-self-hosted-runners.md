---
story_id: story-public-ci-self-hosted-runners
title: 公開CIをself-hosted runnerだけで実行する
status: active
contract_type: bug_fix
view: dev
period: 2026-10
started_at: 2026-10-15
---

# 公開CIをself-hosted runnerだけで実行する

## Problem Frame

- status: valid
- statement: 公開リポジトリ Unson-LLC/brainbase のCIが GitHub-hosted runner の ubuntu-latest で実行されている。
- reason: 佐藤さん 2026-10-15 08:53 の指示は、CIを self-hosted runner だけで回すことである。公開リポジトリの fork pull request が組織の self-hosted runner に載ると、未信頼のコードが組織のマシンで動く。

## Constraints

### self-hosted-only
- kind: invariant
- statement: test、npm-publish、docs-cloudflare-pages、public-message-promotion の各jobは runs-on に self-hosted, Linux, X64, wsl-linux, nucbox-evo-x2 だけを使い、ubuntu-latest を使わない。例外は npm-publish の publish job だけで、ubuntu-latest で実行する（npm が self-hosted runner からの provenance を拒否するため。2026-10-15 佐藤さんの判断）。

### same-repo-head
- kind: invariant
- statement: pull_request で起動するjobは、github.event.pull_request.head.repo.full_name が github.repository と一致するときだけ実行する。

### npm-secret-boundary
- kind: invariant
- statement: npm-publish は pull request head を checkout せず、NODE_AUTH_TOKEN は publish job だけが読む。

## Options

### option-pin-self-hosted
- summary: 全jobを EVO-X2 の self-hosted ラベルへ移し、fork の pull_request は job の if で止める。npm-publish の checkout と secret の位置は変えない。
- action: fix
- addresses: self-hosted-only, same-repo-head, npm-secret-boundary
- violates:
- residual_risk: medium

### option-keep-github-hosted
- summary: ubuntu-latest のままにする。
- action: retire
- addresses:
- violates: self-hosted-only
- residual_risk: high

## Acceptance Criteria

- [x] AC-001: `.github/workflows/test.yml`、`npm-publish.yml`、`docs-cloudflare-pages.yml`、`public-message-promotion.yml` の全job（`npm-publish.yml` の publish job を除く。AC-009）が `runs-on: [self-hosted, Linux, X64, wsl-linux, nucbox-evo-x2]` であり、`ubuntu-latest` を含まない。
- [x] AC-002: `pull_request` で動くjobは `github.event.pull_request.head.repo.full_name == github.repository` のときだけ実行する。`docs-cloudflare-pages.yml` の push と workflow_dispatch は同じ条件で止まらない。
- [x] AC-003: どのworkflowも `pull_request_target` で pull request head を checkout しない。`npm-publish.yml` は develop と merge commit または develop の祖先だけを checkout し、`NODE_AUTH_TOKEN` は publish job だけが持つ。
- [x] AC-004: `docs/guides/github-actions-cicd-operating-guide.md` がランナーラベル、fork pull request の止め方、`author_association` を OR にしない理由、npm-publish の checkout 境界を書く。
- [x] AC-005: job の env は secret を参照しない。`CLOUDFLARE_ACCOUNT_ID`、`CLOUDFLARE_API_TOKEN`、`BRAINBASE_SERVICE_JWT` は、それらを使う step の env だけに置く。wrangler-action の `with` は `secrets.*` を直接参照する。
- [x] AC-006: 5 件の `actions/checkout` はすべて `persist-credentials: false` である。`public-message-promotion.yml` の `git push` は、そのコマンドだけで `GH_TOKEN` を渡す。
- [x] AC-007: すべての `uses` は公式タグと一致する 40 文字の commit SHA に固定され、行末にタグコメントがある。
- [ ] AC-008: `test.yml` のテストは Vitest の並列数を `--maxWorkers=4` に固定する。EVO-X2 の複数の runner が同時に動いても、変更と無関係なテストが時間切れで落ちない（2026-10-15、PR #786 で既定の並列数のまま3回続けて時間切れが起きたための追加）。
- [ ] AC-009: `npm-publish.yml` の publish job だけは `runs-on: ubuntu-latest` で実行し、`--provenance` と `id-token: write` を保つ。npm は self-hosted runner からの provenance を `E422 Unsupported GitHub Actions runner environment: "self-hosted"` で拒否する（2026-10-15、0.41.5 の run 38713407935 で公開が止まったための追加。佐藤さん判断：publish job だけ GitHub-hosted に戻す）。
