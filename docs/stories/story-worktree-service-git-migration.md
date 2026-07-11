---
story_id: story-worktree-service-git-migration
title: worktree-serviceの完全git化（jj依存撤去）
source_requirement:
  type: infrastructure_decision
  description: 2026-07-11にworkspace全体でJujutsu(jj)を廃止した。code/brainbaseのworktree-service.jsにjj依存が残っており、このリポジトリだけ.jjを温存している。セッションworktreeの作成・状態取得・マージ・正本repoデプロイガードをgitネイティブ実装へ移行する。
architecture_docs:
  - path: docs/architecture/worktree-service-git-migration.md
    status: new
    reason: jjコマンド→git等価コマンドのマッピングとデプロイガード保護レベルの維持方針を定義する。
related_tasks:
  - task_source: VibePro
    task_ids: [story-worktree-service-git-migration]
status: active
created_at: 2026-07-11
updated_at: 2026-07-11
---

# worktree-serviceの完全git化（jj依存撤去）

## Background

Brainbaseのセッションworktree管理（`server/services/worktree-service.js`）はJujutsu workspaceを前提に実装されている。2026-07-11のjj全廃に伴い、このサービスが唯一のjj依存として残った。特に重要なのは正本repoマージデプロイガード（`getMergeDeploymentGuardStatus` / `syncCanonicalWorkspaceAfterMerge`）で、「PR merge済みなのにサーバーが読むcheckoutに反映されない」事故の再発防止装置である。この保護をgitで同等以上に再実装しなければならない（単純削除は不可）。

## Scope

- `_isJujutsuRepo()` を廃止し、gitリポジトリ判定（`git rev-parse --git-dir`）へ置換する。
- 正本repoマージデプロイガードをgit化する: 正本checkoutのHEADとmainブランチ（origin/HEAD解決、現状develop）の一致検査、dirty検査、artifact-onlyデルタの許容を維持する。ガード不能時は従来どおり `ready:false` で止める。
- `jj git fetch` → `git fetch origin`、`bookmark list` → `git branch/for-each-ref`、`log -r base..target` → `git rev-list --count`、`resolve --list` → `git ls-files -u`/`diff --diff-filter=U`、`workspace update-stale` → 廃止（git worktreeにstale概念なし。index.lock回復は維持）。
- workspace作成/削除/rotationを `git worktree add/remove` ベースへ移行し、手書きの `.git/worktrees` メタデータ合成（`_ensureGitCompatibility`）を廃止する。
- コミットログ取得はgit経路（`_getGitCommitLog`）へ一本化する。
- `server/controllers/session/runtime-handlers.js` のjj診断コマンド（jj status/log/bookmark list）をgit等価へ置換する。
- `tests/server/services/worktree-service-*.test.js`（7ファイル）をgit前提へ追従させる。
- 本Story外（マージ後の運用作業）: `.jj` ディレクトリ撤去、`.claude/commands/deploy-merged-pr.md`（root repo / brainbase）のgitフロー化、正本checkoutのdetached HEAD→develop復帰。

## Acceptance Criteria

- [ ] ac:1 セッションworktreeの作成・再利用・削除・世代rotationがjjコマンドを一切呼ばずgit worktree/branchで完結する。
- [ ] ac:2 正本repoマージデプロイガードは、正本checkoutがmainブランチのHEADと不一致、または関連ファイルがdirtyな場合に `ready:false` を返し、artifact-onlyの差分では `ready:true` を維持する。
- [ ] ac:3 マージ後の正本同期（`syncCanonicalWorkspaceAfterMerge`）はfetch＋fast-forwardで正本checkoutをmainブランチへ揃え、同期不能時はエラーとして報告する（黙って成功にしない）。
- [ ] ac:4 セッション状態取得（getStatus）は未push commit数・working copy dirty・コンフリクト有無をgitコマンドのみで報告する。
- [ ] ac:5 `server/` 配下のプロダクションコードに `jj` コマンド呼び出しが残っていない。

## Verification

```bash
npm run test:run -- tests/server/services/worktree-service-commit-log.test.js tests/server/services/worktree-service-conflict-inspect.test.js tests/server/services/worktree-service-remove.test.js tests/server/services/worktree-service-repo-mutex.test.js tests/server/services/worktree-service-stale-lock.test.js tests/server/services/worktree-service-workspace-generation.test.js tests/server/services/worktree-service-zombie-cleanup.test.js
node --check server/services/worktree-service.js
node --check server/controllers/session/runtime-handlers.js
grep -rn "\bjj -R\|jj git\|jj workspace\|jj bookmark\|jj log\|jj status\|jj resolve" server/ --include="*.js" ; test $? -eq 1
vibepro pr prepare . --base origin/develop --story-id story-worktree-service-git-migration
```
