---
name: brainbase-untrackedファイルがorigin-mainに同一内容で存在するとff-mergeをブロッ
description: untrackedファイルがorigin/mainに同一内容で存在するとff mergeをブロックする
---

# brainbase-untrackedファイルがorigin-mainに同一内容で存在するとff-mergeをブロッ

## Trigger
- Use when this pattern appears: untrackedファイルがorigin/mainに同一内容で存在するとff mergeをブロックする

## Steps
- git fetch origin main
- git diff --no-index <untracked-file> <(git show origin/main:<path>) 相当で内容一致を確認
- または一時ファイルにgit show origin/main:<path>を書き出してdiff
- 一致かつlocal独自変更でない場合のみrm -f <files>
- git merge --ff-only origin/main
- git status --shortでclean確認

## Guardrails
- Do not override the linked wiki rule.
- Escalate if the current case contradicts the wiki guidance.

## Linked Wiki
- architecture/untrackedファイルがorigin-mainに同一内容で存在するとff-mergeをブロッ

## Source
- Promoted from explicit_learn / success