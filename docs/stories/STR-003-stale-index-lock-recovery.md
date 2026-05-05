---
story_id: STR-003
title: brainbase main repo の stale .git/index.lock を自動検出・自動復旧する
source_requirement:
  type: internal_incident
  description: 5/2 18:42 並走archive で `.git/index.lock` 残置 → 4日間セッションworktree作成が silent fail。STR-002で archive 経路の PR は廃止したが、jj/git のロック競合自体は解消されていない
architecture_docs:
  - path: N/A
    status: not_required
    reason: 既存`_execJujutsuWithStaleRetry`の防御パターン（stale working copy → update-stale → retry）を、index.lock の場合に拡張する局所追加。新しい設計概念は導入しない。
related_tasks:
  - task_source: NocoDB タスク管理
    task_ids: []
status: draft
created_at: 2026-05-06
updated_at: 2026-05-06
---

# STR-003: brainbase main repo の stale `.git/index.lock` を自動検出・自動復旧する

## 背景

STR-002 で archive 経路の PR/CI 浪費は解消したが、ロック競合の **根本原因**（`jj`/`git` 操作が main repo `.git/index` を取り合う構造）は手付かずのまま残っている。

5/2 18:42 の事象:
- session-1777592469476 と session-1777377820685 でアーカイブを並走
- `worktreeService.merge` 内 `jj git push --bookmark` または `_ensureGitCompatibility` の `git -C <repoPath> branch --force` が main repo `.git/index` を取り合い
- 片方が異常終了 → `.git/index.lock` (size=0) が残置
- **4日間** 新規セッション `jj workspace add ... -r main` がすべて失敗（"Failed to reset Git HEAD state / Could not acquire lock for index file / The lockfile ... might need manual deletion."）
- ユーザーが「workspace を選んだのに切られない」と気づくまで誰も検知できなかった

## 現状の問題

1. **silent fail**: brainbase-ui は worktree 作成失敗を catch して main repo path にフォールバックしてセッションを開く。エラーログは `error.log` に1行残るだけ
2. **手動復旧前提**: jj 自身も "lockfile … might need manual deletion." と人間に丸投げ
3. **検出困難**: 影響を受けたセッションは state.db で `worktree=null` だが、UI 上は普通に動いて見える

## 変更内容

`_execJujutsuWithStaleRetry` を index.lock エラーにも対応するように拡張する。

```
旧: jj exec → fails with "working copy is stale" → workspace update-stale → retry
新: jj exec → fails with "Could not acquire lock for index file"
              → check if .git/index.lock is stale (lsof で活物プロセスなし、mtime > 30秒)
              → 削除 + retry
```

具体的に追加するヘルパ:

- `_isIndexLockError(error)`: error message が "Could not acquire lock for index file" / "index.lock" を含むかを判定
- `_isStaleLockfile(lockPath)`: `lsof <lockPath>` で活物プロセスが無く、mtime が30秒以上前ならtrue
- `_recoverStaleLockfile(repoPath)`: `<repoPath>/.git/index.lock` が stale ならファイル削除してログ出力

`_execJujutsuWithStaleRetry` を以下に変更:

```js
async _execJujutsuWithStaleRetry(repoPath, command, options = {}) {
    const { retryStale = true } = options;
    const fullCommand = `jj -R "${repoPath}" ${command}`;
    try {
        return await this.execPromise(fullCommand);
    } catch (error) {
        if (retryStale && this._isStaleWorkingCopyError(error)) {
            logger.warn(`[workspace] Detected stale jj working copy at ${repoPath}, healing before retry`);
            await this.execPromise(`jj -R "${repoPath}" workspace update-stale`);
            return await this.execPromise(fullCommand);
        }
        if (this._isIndexLockError(error) && await this._recoverStaleLockfile(repoPath)) {
            return await this.execPromise(fullCommand);
        }
        throw error;
    }
}
```

## 受け入れ基準

- [ ] `jj` コマンドが index.lock エラーで失敗し、lockfile が stale なら自動削除して再試行する
- [ ] lockfile が活物プロセスに保持されている場合は削除しない（lsof で検出）
- [ ] lockfile が新しい (mtime < 30秒) 場合は削除しない（他プロセスが正常進行中の可能性）
- [ ] 削除実行時に `[workspace] Removed stale index.lock at ...` の警告ログが出る
- [ ] index.lock 以外のエラー（ネットワーク、認証、構文）は従来通り throw される
- [ ] `_isStaleWorkingCopyError` 経路は従来通り動作する（リグレッションなし）

## スコープ外

- main repo `.git/index` を全く触らない経路への書き換え（`_ensureGitCompatibility` の `git branch --force` を worktree 側で完結する設計変更等）→ より大きい設計変更で別Story
- per-repo mutex によるそもそもの並走防止 → 必要性が出てきたら追加。今回は「事故が起きてもsilent failしない」を優先
- `merge()` 内の `jj git push` への適用 → 同じ_execJujutsuWithStaleRetryに通せば自動的に効くようリファクタするのは将来作業（今回は `_execJujutsuWithStaleRetry` 経路のみ）

## 実装タスク

1. Red: 新ヘルパと拡張動作のテストを追加
2. Green: `_isIndexLockError` / `_isStaleLockfile` / `_recoverStaleLockfile` を実装、`_execJujutsuWithStaleRetry` 拡張
3. 関連テスト確認 (worktree-service-* tests pass)
4. vibepro pr prepare → PR

## 検証コマンド

```bash
# 単体
npm test -- --runTestsByPath tests/server/services/worktree-service-stale-lock.test.js --runInBand

# 関連
npm test -- --runTestsByPath tests/server/services/worktree-service-commit-log.test.js \
  tests/server/services/worktree-service-remove.test.js \
  tests/server/services/worktree-service-zombie-cleanup.test.js
```

## レビュー観点

- mtime 閾値 30秒 が短すぎないか（jj/git の通常書き込み中に誤判定しないか）
- `lsof` がインストールされていない環境（コンテナ等）でフォールバックが妥当か
- lockfile 削除がレース条件で他プロセスの操作を破壊しないか（lsof + mtime の二重防御で十分か）
