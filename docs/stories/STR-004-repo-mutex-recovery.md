---
story_id: STR-004
title: brainbase main repo の jj/git 書き込みを per-repoPath mutex で直列化し、merge() にも index.lock 自動復旧を適用
source_requirement:
  type: internal_followup
  description: STR-003 で stale lockfile 自動復旧を入れたが、根本の並走防止と merge() 内 直 execPromise 呼び出しは未対応のまま
architecture_docs:
  - path: N/A
    status: not_required
    reason: 既存 WorktreeService 内に private mutex を追加するだけの局所変更。新規モジュール・新規依存・外部APIなし。
related_tasks:
  - task_source: NocoDB タスク管理
    task_ids: []
status: draft
created_at: 2026-05-06
updated_at: 2026-05-06
---

# STR-004: brainbase main repo の jj/git 書き込みを per-repoPath mutex で直列化し、merge() にも index.lock 自動復旧を適用

## 背景

- STR-002 で archive PR は廃止
- STR-003 で stale `.git/index.lock` の自動復旧（事後）を導入

残っているリスク:
1. 並走で `.git/index.lock` を取り合うこと自体は依然発生する。STR-003 の事後復旧は最後のセーフティネットでしかなく、並走中の jj が `Could not acquire lock for index file` で 1回失敗 → STR-003 経路で復旧 → retry … という挙動になる。**正常系で1回失敗して必ず warn が出る**のは健全ではない。
2. `merge()` 内の `jj -R ... git push --bookmark` 等は `execPromise` 直呼びで、STR-003 の auto-recovery 経路 (`_execJujutsuWithStaleRetry`) を通っていない。merge 中に index.lock 残置を踏むと普通に失敗する。

## 変更内容

### 1. per-repo mutex を導入（事前防止）

`WorktreeService` に private な `_repoMutex: Map<repoPath, Promise>` を追加し、同一 `repoPath` 上の主要な jj/git 書き込みを直列化する。

```js
async _withRepoLock(repoPath, fn) {
    const prev = this._repoMutex.get(repoPath) || Promise.resolve();
    const next = prev.then(fn, fn);  // 前の失敗で後続を止めない
    this._repoMutex.set(repoPath, next.then(() => {}, () => {}));
    return next;
}
```

適用箇所:
- `_execJujutsuWithStaleRetry`（既存。jj 経由の主要パス）
- `_ensureGitCompatibility` の `git -C "${repoPath}" rev-parse HEAD` / `branch --force`（main repo を直接書く git）
- `merge()` の `jj git push --bookmark` を `_execJujutsuWithStaleRetry` 経由に切替

worktree-側 (`workspacePath`) を対象にした exec は対象外（main repo の index に触らない）。

### 2. merge() 内の direct execPromise を _execJujutsuWithStaleRetry 経由へ

`worktreeService.merge()` 内で main repo を触る jj 呼び出しを `_execJujutsuWithStaleRetry` 経由にする。これで STR-003 の auto-recovery が merge にも自動適用される。

該当箇所:
- `jj -R "${repoPath}" git push --bookmark "${bookmarkName}"`
- `jj -R "${repoPath}" log -r "..."` （read だが直列化されていれば mutex 待ちで安全）
- `jj -R "${repoPath}" workspace forget`
- `jj -R "${repoPath}" bookmark delete`

`gh pr create` / `gh pr merge` は GitHub API 経由で main repo `.git/index` を触らないため対象外。

## 受け入れ基準

- [ ] `_withRepoLock(repoPath, fn)` は同一 `repoPath` で同時呼び出しを直列化する
- [ ] 異なる `repoPath` の呼び出しは互いに待たない（並列実行される）
- [ ] mutex 内で例外が発生しても次の呼び出しは正しく実行される（前の失敗で chain 全体が止まらない）
- [ ] `_execJujutsuWithStaleRetry` は同一 `repoPath` で並走呼び出されたとき、内部 exec が直列実行される
- [ ] `_ensureGitCompatibility` の main-repo git 呼び出しが `_withRepoLock` を経由している
- [ ] `merge()` の `jj git push --bookmark` が `_execJujutsuWithStaleRetry` 経由（=mutex + auto-recovery が効く）になっている
- [ ] STR-003 の既存テスト（worktree-service-stale-lock）がリグレッションせずパスする

## スコープ外（"won't fix" 含む）

### `_ensureGitCompatibility` を main repo 非接触に再設計（旧候補項目2）

**やらない判断**。理由:

調査の結果、`.git/index.lock` を取るのは **brainbase-ui のコードではなく `jj` 自身** であることが確認された:

```
$ jj -R /repo workspace add ...
Error: Failed to reset Git HEAD state    ← jj 内部の git compat layer
Caused by:
1: Could not acquire lock for index file
```

`jj` は `colocated git repo` モード下で workspace add するときに main repo の git HEAD/index を更新する。これは jj 側の仕様であり、brainbase-ui 側のコード（`_ensureGitCompatibility` の `git branch --force` など）を消しても解消しない。回避するには:
- jj の colocated mode を捨てる → jj-git interop を全部自前で再実装する必要があり大規模改修
- or jj 側に PR を投げる → 外部依存

費用対効果として現時点では割に合わない。STR-003（事後復旧） + STR-004（並走防止）の組み合わせで実用上のリスクは十分に低くなる。再発するなら再評価。

### per-process より広い mutex（例: ファイルベース flock）

複数の brainbase-ui プロセスが同時に動く想定が現状ないため見送り。launchd の `KeepAlive` は単一プロセスを保証する。複数プロセス共存が要件になったら再検討。

## 実装タスク

1. Red: `_withRepoLock` の直列化テスト追加
2. Red: `_execJujutsuWithStaleRetry` の同 repoPath 並走直列化テスト
3. Red: `merge()` が `_execJujutsuWithStaleRetry` 経由で push する（=auto-recovery が効く）テスト
4. Green: `_repoMutex` + `_withRepoLock` 実装、`_execJujutsuWithStaleRetry` を mutex でラップ、`_ensureGitCompatibility` の main-repo git 呼び出しを mutex 化、`merge()` の該当 jj 呼び出しを `_execJujutsuWithStaleRetry` 経由に置換
5. 関連テスト確認

## 検証コマンド

```bash
npm test -- --runTestsByPath \
  tests/server/services/worktree-service-stale-lock.test.js \
  tests/server/services/worktree-service-repo-mutex.test.js \
  --runInBand
```

## レビュー観点

- mutex chain で前の失敗が後続に伝播しないことを保証する `prev.then(fn, fn)` パターンの妥当性
- 異なる repoPath で並列実行されることをテストで担保
- `_repoMutex` の Map がメモリリークにならないか（既知の repoPath 数は数個なので実質無問題）
- merge() の `gh pr create/merge` を mutex に含めない判断（main repo `.git/index` 非接触のため不要）
