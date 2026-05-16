---
name: brainbase-複数-worktree-環境では-gh-pr-merge-が-checkout-起因で失敗するた
description: "複数 worktree 環境では `gh pr merge` が checkout 起因で失敗するため API merge を fallback にする"
---

# brainbase-複数-worktree-環境では-gh-pr-merge-が-checkout-起因で失敗するた

## Trigger
- Use when this pattern appears: 複数 worktree 環境では `gh pr merge` が checkout 起因で失敗するため API merge を fallback にする

## Steps
- 失敗例:
- `gh pr merge 41 --merge --delete-branch`
- fallback:
- `gh api repos/<owner>/<repo>/pulls/<pr-number>/merge -X PUT -f merge_method=merge`
- 確認:
- `gh pr view <pr-number> --json state,mergedAt,mergeCommit`

## Guardrails
- Do not override the linked wiki rule.
- Escalate if the current case contradicts the wiki guidance.

## Linked Wiki
- specs/複数-worktree-環境では-gh-pr-merge-が-checkout-起因で失敗するた

## Source
- Promoted from explicit_learn / success