---
name: branch-worktree-rules
description: Distribution Modelに沿ってrepoとworktreeの所有境界を守り、dirtyな作業ツリーや個人ホームを上書きせずに変更を分離するためのSkill。
---

# ブランチ・Worktree運用ルール

## 原則

1. repoごとに独立したbranch/worktreeを使う。
2. 既存のdirty変更は利用者の所有物として扱い、混ぜない・上書きしない。
3. 一つの意図を一つのfocused commitにする。
4. `shared/`、`_codex/`、個人ホームへのsymlinkで複数repoを束ねない。
5. 正本だからという理由でmainへ直接書かない。対象repoの通常レビュー経路を使う。

## 配置とコミット先

| 変更 | 作業場所 | コミット先 |
|---|---|---|
| brainbaseのserver / Skills / Commands / Agents / hooks | `code/brainbase` の隔離worktree | brainbase-unsonのbranch |
| 事業文書 | 対応する `projects/{project}` cloneの隔離worktree | `{project}-project.git` のbranch |
| 佐藤個人のSNS・knowledge・docs | workspace root repoの隔離worktree | brainbase-configのbranch |
| 人・組織・意思決定・RACI等の事実 | Graph API | Gitへ重複保存しない |
| 個人タスク | NocoDB | ローカル `_tasks/` を作らない |
| 予定 | Google Calendar | ローカル `_schedules/` を作らない |

## 開始手順

```bash
git status --short --branch
git diff --name-status
git diff --cached --name-status
git fetch origin
git worktree add /private/tmp/<name> -b codex/<intent> origin/<base>
```

base branchとremote trackingはrepoごとに確認する。dirtyな元worktree内でbranchを切り替えない。

## 完了手順

```bash
git diff --check
git status --short
git add <今回触ったファイルだけ>
git diff --cached --check
git commit
git push -u origin codex/<intent>
```

`git add -A`、無関係なstash、reset、既存変更の復元は行わない。複数repoに跨る場合はrepoごとにcommitを分け、依存順と未統合状態を報告する。
