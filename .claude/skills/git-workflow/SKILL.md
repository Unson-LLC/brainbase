---
name: git-workflow
description: brainbaseのJujutsuワークフロー（/commit、/merge）への準拠をチェック。Conventional Commits、Decision-making capture、Workspace safetyを自動検証。
---

# Jujutsu Workflow

**目的**: brainbaseのJujutsu運用原則への準拠をチェックし、正しいコミット・マージを支援

このSkillは、CLAUDE.mdで定義された `jj` 運用ルールを自動的に実践します。

## Workflow Overview

```
Phase 1: Conventional Commitsチェック
└── agents/phase1_commit_checker.md
    └── type(scope): summary 形式か判断
    └── type一覧（feat/fix/docs/refactor等）に準拠しているか確認

Phase 2: Decision-making captureチェック
└── agents/phase2_decision_checker.md
    └── 悩み→判断→結果が記録されているか確認

Phase 3: Workspace safetyチェック
└── agents/phase3_branch_checker.md
    └── session workspace か確認
    └── default workspace への直接コミット防止
```

## コミット形式

```
type(scope): summary

悩み: [判断前の課題]
判断: [選択した方針]
結果: [実装結果]

🤖 Generated with [Claude Code](https://claude.com/claude-code)
Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>
```

## PRマージ後のworkspace更新（必須フロー）

**問題**: PRをマージしても、サーバーのworkspace（`default@`）は自動更新されない

**必須手順**:

```bash
# 1. 最新を取得
jj git fetch

# 2. サーバーworkspaceを更新
jj rebase -b default@ -d develop

# 3. 変更内容を確認
jj diff -r 'default@^::default@' --stat

# 4. 再起動判定
# - server/ 配下の変更 → 再起動必要
# - public/ のみの変更 → 再起動不要（ブラウザリロード）

# 5. 再起動（必要な場合のみ）
launchctl kickstart -k gui/$(id -u)/com.brainbase.ui
```

**コマンド**: `/deploy-merged-pr` を使用すると自動実行される

**なぜ必要か**:
- jjのworkspaceはGitのworktreeと同様、自動更新されない
- サーバーは`default@`から起動しているため、手動更新が必須

## 参照

- **CLAUDE.md**: `§6.5 Commit (Decision capture)`
- **Skills**: git-commit-rules
- **Commands**: `/deploy-merged-pr`

---

最終更新: 2026-02-27
