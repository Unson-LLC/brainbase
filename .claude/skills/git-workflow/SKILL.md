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

## 回帰防止コミット戦略（必須）

`fix` / `feat` のコミットでは、以下を満たさない場合はコミットしない。

1. **Single-intent commit**
- 1コミットに1つの意図だけを含める
- 速度改善・UI変更・API変更を同一コミットに混在させない

2. **Risky file guard**
- 以下の高リスクファイルは、変更理由をコミット本文に明記する
- `public/app.js`
- `server/controllers/session-controller.js`
- `server/routes/sessions.js`
- `public/style.css`

3. **Behavior regression check**
- 既存フローに関わる削除 (`-` 行) がある場合、影響機能を列挙する
- 例: `markDoneAsRead`, `clear-done`, `session-context-bar`
- 列挙できない削除は「意図しない回帰」の可能性として差し戻す

4. **Targeted test gate**
- 変更対象機能に対応する単体テストを最低1本実行してからコミット
- 実行テスト名をコミット本文に残す

5. **Pre-merge diff scan**
- マージ前に `jj diff -r <base> -r @ -- <high-risk-files>` を実行
- 想定外の削除が1つでもあれば分割 (`jj split`) または再実装してからマージ

この戦略により、機能を巻き込んで消す事故（広範囲コミット由来）を防ぐ。

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

最終更新: 2026-03-04
