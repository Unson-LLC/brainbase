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

## コミット・マージ方針（重要）

**原則**: コミット・マージ対象は「今回のタスクで自分が触ったファイルのみ」。

- 作業開始前から存在する未関連差分は含めない
- 変更ファイルは `git add <file...>` で明示的に指定してステージする
- `git add -A` / `git commit -a` のような全量ステージは使わない
- 未関連差分が残っていても、対象ファイルのみでコミットして先に進める

この方針により、別タスク差分の巻き込みを防ぎ、レビュー対象を明確化する。

## 参照

- **CLAUDE.md**: `§6.5 Commit (Decision capture)`
- **Skills**: git-commit-rules

---

最終更新: 2026-02-28
