---
name: dev-ship
description: >
  Paperclip Dev Team: Ship。main同期→テスト→CHANGELOG→PR作成→振り返りレポート。
  gstack ship + retro を Paperclip heartbeat 用に再設計。完全自動、確認不要。
user_invocable: false
---

# Dev Ship — Release & Retrospective Agent

Paperclip heartbeat で動くリリースエージェント。
Issue の指示に従い、ブランチを main に同期、テスト実行、PR 作成まで自動化。

## Heartbeat フロー

1. Paperclip Skill で自分の割り当て Issue を取得
2. Issue の内容から Ship 対象ブランチを特定
3. Ship ワークフローを実行
4. 結果を Issue コメントに投稿

## Ship ワークフロー

### Step 1: Pre-flight

```bash
BRANCH=$(git branch --show-current)
if [ "$BRANCH" = "main" ]; then
  echo "ERROR: Ship from a feature branch, not main."
  exit 1
fi
git status  # never use -uall
git diff main...HEAD --stat
git log main..HEAD --oneline
```

main ブランチにいたら中止。

### Step 2: Merge origin/main

テスト前に最新 main をマージ:

```bash
git fetch origin main && git merge origin/main --no-edit
```

- **コンフリクト**: 単純なら自動解決（VERSION, CHANGELOG）、複雑なら Issue コメントで報告して中止
- **Up to date**: 続行

### Step 3: テスト実行

プロジェクトのテストコマンドを検出して実行:

```bash
# 検出順序
if [ -f "package.json" ]; then
  npm test || yarn test || bun test
elif [ -f "Makefile" ]; then
  make test
elif [ -f "pytest.ini" ] || [ -f "setup.py" ]; then
  python -m pytest
elif [ -f "Gemfile" ]; then
  bundle exec rspec || bundle exec rake test
fi
```

テスト失敗 → Issue コメントで報告して中止。

### Step 4: Pre-Landing Review

`dev-reviewer` Skill の 2パスレビューを簡略実行:

```bash
git fetch origin main --quiet
git diff origin/main
```

- CRITICAL issue あり → Issue コメントで報告、Ship 中止
- INFORMATIONAL のみ → PR本文に記載して続行

### Step 5: VERSION & CHANGELOG

VERSION ファイルがあれば PATCH バンプ:

```bash
if [ -f "VERSION" ]; then
  VERSION=$(cat VERSION)
  # Auto PATCH bump
  NEW_VERSION=$(echo $VERSION | awk -F. '{print $1"."$2"."$3+1}')
  echo $NEW_VERSION > VERSION
fi
```

CHANGELOG 更新:
```bash
if [ -f "CHANGELOG.md" ]; then
  # diff から自動生成して先頭に追加
  CHANGES=$(git log main..HEAD --oneline --no-merges)
  # prepend to CHANGELOG.md
fi
```

### Step 6: コミット & プッシュ

```bash
git add -A
git commit -m "chore: prepare release v$NEW_VERSION

Changes:
$CHANGES

Co-Authored-By: Dev Ship Agent <noreply@paperclip.dev>"

git push origin $BRANCH
```

### Step 7: PR 作成

```bash
gh pr create \
  --title "Release v$NEW_VERSION" \
  --body "$(cat <<'EOF'
## Summary
$SUMMARY

## Pre-Landing Review
$REVIEW_RESULTS

## Test Results
All tests passing ✅

## Changes
$CHANGES
EOF
)"
```

### Step 8: レポート投稿

Issue コメントに Ship 結果を投稿:

```markdown
## 🚀 Ship Complete

**Branch:** feature/xxx
**PR:** #123
**Version:** v1.2.3 → v1.2.4

### Changes
- commit1: description
- commit2: description

### Review Summary
- Critical: 0
- Informational: N

### Test Results
All passing ✅
```

## Retro モード（振り返り）

Issue に "retro" キーワードがある場合、Ship の代わりに振り返りレポートを生成:

### データ収集

```bash
git fetch origin main --quiet
git log origin/main --since="7 days ago" --format="%H|%aN|%ae|%ai|%s" --shortstat
git log origin/main --since="7 days ago" --format="COMMIT:%H|%aN" --numstat
```

### レポート構造

```markdown
## 📊 Weekly Retro

**Period:** [開始日] — [終了日]

### Summary
- Commits: N
- Files changed: N
- Lines: +N / -N
- Contributors: N

### Per-Contributor Breakdown

#### [Name]
- Commits: N
- Focus areas: [ファイル/ディレクトリ]
- 🌟 Highlights: [良かった点]
- 📈 Growth areas: [改善点]

### Patterns
- [パターン分析: テストカバレッジ、コミットサイズ、レビュー速度等]

### Recommendations
1. [具体的な改善提案]
```

## 中止条件

以下の場合のみ Ship を中止:

- main ブランチにいる
- マージコンフリクトが複雑
- テスト失敗
- CRITICAL レビュー issue あり

## 自動実行（確認しない）

以下は自動で実行、確認不要:

- 未コミット変更の取り込み
- PATCH バージョンバンプ
- CHANGELOG 生成
- コミットメッセージ
- PR 作成
