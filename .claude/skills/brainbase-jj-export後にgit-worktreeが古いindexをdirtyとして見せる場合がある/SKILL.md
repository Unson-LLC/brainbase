---
name: brainbase-jj-export後にgit-worktreeが古いindexをdirtyとして見せる場合がある
description: "BrainbaseのJJ運用で jj export / bookmark sync 後にGit worktreeやindexが古いtreeをdirtyとして見せる場合の確認手順"
---

# brainbase-jj-export後にgit-worktreeが古いindexをdirtyとして見せる場合がある

## Trigger

- Brainbaseで `jj export`、`jj bookmark set main -r main@origin`、またはJJ側のbookmark同期を行った後にGit worktreeがdirtyに見える
- `git status` に大量の staged/unstaged 差分が出るが、ユーザがそのworktreeで作業した心当たりがない
- checked-out branchのreflogに `export from jj` があり、dirty diffが直近コミット群を戻すように見える

## Steps

1. まずstashしない。dirtyを消す前に分類する。
2. Git worktree側で状態を記録する:
   - `git status --short --branch`
   - `git diff --name-status`
   - `git diff --cached --name-status`
   - `git diff --stat`
   - `git diff --cached --stat`
   - `git reflog --date=iso -8 HEAD`
   - `git reflog --date=iso -8 <branch>`
3. branch reflogで `export from jj` などにより `<old>` から `<new>` へ進んだ箇所を特定する。
4. dirtyがstale reverse diffか検証する:
   - `git diff --stat <old> <new>`
   - `git diff --stat <new> <old>`
   - `git diff --name-status <old> <new>`
   - `git diff --name-status <new> <old>`
5. `git diff --cached --stat` / `git diff --stat` が `<new> <old>` の逆差分と一致し、追加のhunkがない場合だけ「JJ同期後のGit index/worktree stale」と判断する。
6. stale reverse diffと証明できた場合は、stashとして保存せず、worktree/indexを`HEAD`へ同期する。どのコマンドを使ったかと、比較した `<old>` / `<new>` を報告する。
7. 一致しないファイルやhunkがある場合はユーザ作業の可能性があるため、消さずにファイル一覧と差分の性質を報告する。

## Guardrails

- `jj log` がcleanでもGit worktree/indexがcleanとは限らない。必ずGit側のstatusとcached diffを見る。
- `git stash` は証拠を隠すので初手にしない。退避が必要な場合も、stale reverse diffかユーザ作業かを分類してから行う。
- VibeProや他プロダクト固有の問題として扱わない。BrainbaseのJJ + 複数Git worktree運用上の同期問題として扱う。
- ユーザ作業か不明なdirtyは消さない。

## Source

- 2026-05-19 VibePro main worktreeで、`jj export` により branch ref が `9152109 -> f7079e7` へ進んだ一方、Git index/worktreeが古いtreeを保持し、`d11ef9f..f7079e7` を戻すstaged reverse diffとして見えた事象から追加。
