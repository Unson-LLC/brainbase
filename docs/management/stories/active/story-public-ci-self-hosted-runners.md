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
- statement: test、npm-publish、docs-cloudflare-pages、public-message-promotion の各jobは runs-on に self-hosted, Linux, X64, wsl-linux, nucbox-evo-x2 だけを使い、ubuntu-latest を使わない。

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

- [ ] AC-001: `.github/workflows/test.yml`、`npm-publish.yml`、`docs-cloudflare-pages.yml`、`public-message-promotion.yml` の全jobが `runs-on: [self-hosted, Linux, X64, wsl-linux, nucbox-evo-x2]` であり、`ubuntu-latest` を含まない。
- [ ] AC-002: `pull_request` で動くjobは `github.event.pull_request.head.repo.full_name == github.repository` のときだけ実行する。`docs-cloudflare-pages.yml` の push と workflow_dispatch は同じ条件で止まらない。
- [ ] AC-003: どのworkflowも `pull_request_target` で pull request head を checkout しない。`npm-publish.yml` は develop と merge commit または develop の祖先だけを checkout し、`NODE_AUTH_TOKEN` は publish job だけが持つ。
- [ ] AC-004: `docs/guides/github-actions-cicd-operating-guide.md` がランナーラベル、fork pull request の止め方、`author_association` を OR にしない理由、npm-publish の checkout 境界を書く。
