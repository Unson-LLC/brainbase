---
name: brainbase-brainbaseのdirty表示は正規repoではなくセッションworktreeの状態を見てい
description: Brainbaseのdirty表示は正規repoではなくセッションworktreeの状態を見ている場合がある
---

# brainbase-brainbaseのdirty表示は正規repoではなくセッションworktreeの状態を見てい

## Trigger
- Use when this pattern appears: Brainbaseのdirty表示は正規repoではなくセッションworktreeの状態を見ている場合がある

## Steps
- UIのセッションworktree pathを確認
- git -C <session-worktree> status --short
- git -C <session-worktree> log --oneline -5
- 必要ならorigin/mainとの差分やbehindを確認
- git clean/merge後、最大30秒待つかタブ復帰・セッション切替でrefreshを促す

## Guardrails
- Do not override the linked wiki rule.
- Escalate if the current case contradicts the wiki guidance.

## Linked Wiki
- architecture/brainbaseのdirty表示は正規repoではなくセッションworktreeの状態を見てい

## Source
- Promoted from explicit_learn / success