---
name: brainbase-複数-worktree-をまたぐ修正では-作成した-story-やテストが-commit-対象-
description: 複数 worktree をまたぐ修正では、作成した Story やテストが commit 対象 worktree に存在するか確認する
---

# brainbase-複数-worktree-をまたぐ修正では-作成した-story-やテストが-commit-対象-

## Trigger
- Use when this pattern appears: 複数 worktree をまたぐ修正では、作成した Story やテストが commit 対象 worktree に存在するか確認する

## Steps
- 作業開始時に WT=<commit対象worktree> を固定する
- Story/テスト/実装ファイルは $WT 配下に作る
- 切替後は git -C "$WT" status --short と ls "$WT/<path>" で存在確認する
- git add 前に対象ファイル一覧を $WT 基準で確認する

## Guardrails
- Do not override the linked wiki rule.
- Escalate if the current case contradicts the wiki guidance.

## Linked Wiki
- stories/複数-worktree-をまたぐ修正では-作成した-story-やテストが-commit-対象-

## Source
- Promoted from explicit_learn / success