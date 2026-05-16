---
name: brainbase-gh-pr-merge後にjjのローカルmainが更新されない場合はmain-originへ合わ
description: "gh pr merge後にjjのローカルmainが更新されない場合はmain@originへ合わせる"
---

# brainbase-gh-pr-merge後にjjのローカルmainが更新されない場合はmain-originへ合わ

## Trigger
- Use when this pattern appears: gh pr merge後にjjのローカルmainが更新されない場合はmain@originへ合わせる

## Steps
- gh pr view <pr> --json state,mergeCommit,mergedAt
- jj git fetch --remote origin
- jj log -r "main@origin" --no-pager -n 3
- jj bookmark set main -r main@origin
- jj log -r "main" --no-pager -n 3

## Guardrails
- Do not override the linked wiki rule.
- Escalate if the current case contradicts the wiki guidance.

## Linked Wiki
- architecture/gh-pr-merge後にjjのローカルmainが更新されない場合はmain-originへ合わ

## Source
- Promoted from explicit_learn / success