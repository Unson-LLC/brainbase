---
name: git-workflow
description: brainbaseのGitワークフロー（/commit、/merge）への準拠をチェック。Conventional Commits、Decision-making capture、Branch safetyを自動検証。
---

# Git Workflow

**目的**: brainbaseのGitワークフロー原則への準拠をチェックし、正しいコミット・マージを支援

このSkillは、CLAUDE.mdで定義されたGit運用ルールを自動的に実践します。

## Workflow Overview

```
Phase 1: Conventional Commitsチェック
└── agents/phase1_commit_checker.md
    └── type(scope): summary 形式か判断
    └── type一覧（feat/fix/docs/refactor等）に準拠しているか確認

Phase 2: Decision-making captureチェック
└── agents/phase2_decision_checker.md
    └── 悩み→判断→結果が記録されているか確認

Phase 3: Branch safetyチェック
└── agents/phase3_branch_checker.md
    └── session/* branchか確認
    └── main/masterへの直接コミット防止
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

## 参照

- **CLAUDE.md**: `§6.5 Commit (Decision capture)`
- **Skills**: git-commit-rules

---

最終更新: 2025-12-31
