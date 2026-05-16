---
name: brainbase-vibepro-は-spec-がないと-graphify-しても-generic-task-しか
description: VibePro は spec がないと Graphify しても generic task しか出ない
---

# brainbase-vibepro-は-spec-がないと-graphify-しても-generic-task-しか

## Trigger
- Use when this pattern appears: VibePro は spec がないと Graphify しても generic task しか出ない

## Steps
- 1. `vibepro story add` / `story select`
- 2. `docs/specs/<story-id>.md` を作成し、対象ファイル・AWS resource・根拠・受入条件・phase を明記
- 3. `vibepro story diagnose --run-graphify` を再実行
- 4. PR は clean worktree で作り、`.vibepro/` は `.gitignore` に入れて evidence state を混入させない

## Guardrails
- Do not override the linked wiki rule.
- Escalate if the current case contradicts the wiki guidance.

## Linked Wiki
- stories/vibepro-は-spec-がないと-graphify-しても-generic-task-しか

## Source
- Promoted from explicit_learn / success