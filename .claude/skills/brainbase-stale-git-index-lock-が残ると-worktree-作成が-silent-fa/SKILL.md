---
name: brainbase-stale-git-index-lock-が残ると-worktree-作成が-silent-fa
description: stale .git/index.lock が残ると worktree 作成が silent fail し、セッションが main repo で起動し続ける
---

# brainbase-stale-git-index-lock-が残ると-worktree-作成が-silent-fa

## Trigger
- Use when this pattern appears: stale .git/index.lock が残ると worktree 作成が silent fail し、セッションが main repo で起動し続ける

## Steps
- sqlite3 /Users/ksato/workspace/var/state.db "SELECT data FROM sessions WHERE id = '<session-id>';" | jq '.path,.worktree'
- ls -l /Users/ksato/workspace/code/brainbase/.git/index.lock
- lsof /Users/ksato/workspace/code/brainbase/.git/index.lock
- lockfile が stale なら mtime と lsof を確認して unlink し、次の jj workspace add を retry する
- 実装側では _isIndexLockError / _isStaleLockfile / _recoverStaleLockfile のように判定・復旧・再試行を worktree service に閉じ込める

## Guardrails
- Do not override the linked wiki rule.
- Escalate if the current case contradicts the wiki guidance.

## Linked Wiki
- stories/stale-git-index-lock-が残ると-worktree-作成が-silent-fa

## Source
- Promoted from explicit_learn / success