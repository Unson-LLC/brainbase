# PR作成コマンド

session/* ブランチから Pull Request を作成します。
コミットメッセージからタイトル・ボディを自動生成し、ブラウザで開きます。

**用途**:
- PRを作成してレビュー依頼（マージはGitHub UIで実施）
- CI/CDチェック、チーム協業

**マージまで行う場合**: `/merge` コマンドのPRモードを使用してください

---

## 0. 前提チェック

実行前に以下を確認してください:
- 現ブランチ: `session/*` であること
- 少なくとも1つのコミットがあること
- GitHub リモートが設定されていること
- gh CLI がインストールされていること (`gh --version`)
- GitHub認証が完了していること (`gh auth status`)

---

## 1. gh CLI インストール確認

```bash
# gh CLI確認
if ! command -v gh &> /dev/null; then
  echo "Error: gh CLI がインストールされていません"
  echo "インストール: brew install gh"
  echo "認証: gh auth login"
  exit 1
fi

# GitHub認証確認
if ! gh auth status &> /dev/null; then
  echo "Error: GitHub認証が必要です"
  echo "実行: gh auth login"
  exit 1
fi
```

---

## 2. ブランチ確認

```bash
CURRENT_BRANCH=$(git branch --show-current)

# session/* チェック
if [[ ! "$CURRENT_BRANCH" =~ ^session/ ]]; then
  echo "Error: session/* ブランチから実行してください"
  echo "現在のブランチ: $CURRENT_BRANCH"
  exit 1
fi

echo "✓ ブランチ: $CURRENT_BRANCH"
```

---

## 3. コミット存在確認

```bash
COMMIT_COUNT=$(git rev-list --count main..HEAD)

if [ "$COMMIT_COUNT" -eq 0 ]; then
  echo "Error: コミットがありません"
  echo "先に /commit でコミットしてください"
  exit 1
fi

echo "✓ コミット数: $COMMIT_COUNT"
```

---

## 4. すでにPRが存在するかチェック

```bash
if gh pr view >/dev/null 2>&1; then
  PR_NUMBER=$(gh pr view --json number -q .number)
  PR_URL=$(gh pr view --json url -q .url)
  echo "Warning: このブランチのPR (#$PR_NUMBER) は既に存在します"
  echo "PR URL: $PR_URL"
  echo ""
  echo "ブラウザで開きますか？ [Y/n]"
  read -r OPEN_BROWSER
  if [[ "$OPEN_BROWSER" != "n" && "$OPEN_BROWSER" != "N" ]]; then
    gh pr view --web
  fi
  exit 0
fi
```

---

## 5. リモートへpush

```bash
echo "📤 リモートへpush中..."
git push -u origin "$CURRENT_BRANCH"

if [ $? -ne 0 ]; then
  echo "Error: push に失敗しました"
  exit 1
fi

echo "✓ Push完了"
```

---

## 6. PR Title生成

```bash
# 単一コミット: 最新コミットのサマリー
if [ "$COMMIT_COUNT" -eq 1 ]; then
  PR_TITLE=$(git log -1 --format="%s")
  echo "✓ PRタイトル（単一コミット）: $PR_TITLE"
fi

# 複数コミット: ブランチ名から推測
if [ "$COMMIT_COUNT" -gt 1 ]; then
  # session/2025-12-29-feature-priority-filter
  # → "feat: priority-filter"

  BRANCH_TYPE=$(echo "$CURRENT_BRANCH" | cut -d- -f4)
  BRANCH_NAME=$(echo "$CURRENT_BRANCH" | cut -d- -f5-)

  case "$BRANCH_TYPE" in
    feature) TYPE="feat" ;;
    fix) TYPE="fix" ;;
    refactor) TYPE="refactor" ;;
    hotfix) TYPE="hotfix" ;;
    *) TYPE="chore" ;;
  esac

  PR_TITLE="$TYPE: $BRANCH_NAME"
  echo "✓ PRタイトル（複数コミット）: $PR_TITLE"
fi
```

---

## 7. PR Body生成

```bash
PR_BODY=$(cat <<EOF
## Summary

$(git log main..HEAD --format="- %s")

## コミット履歴

\`\`\`
$(git log main..HEAD --oneline)
\`\`\`

## Test plan

- [ ] 全てのテストが通ることを確認
- [ ] 変更が意図通りに動作することを確認

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)

echo "✓ PR Body生成完了"
```

---

## 8. PR作成（ブラウザで開く）

```bash
echo "🔧 PR作成中..."

gh pr create \
  --title "$PR_TITLE" \
  --body "$PR_BODY" \
  --web

if [ $? -eq 0 ]; then
  echo ""
  echo "✅ PR作成成功！"
  echo "ブラウザでPRを確認・編集してください"
  echo ""
  echo "マージは以下の方法で実施:"
  echo "  - GitHub UI でマージ（推奨）"
  echo "  - /merge コマンドのPRモード"
else
  echo "Error: PR作成に失敗しました"
  exit 1
fi
```

---

## 注意事項

### PRタイトルとボディの編集

- ブラウザで自動的に開かれるので、必要に応じて手動調整してください
- 特に Test plan は手動でチェック項目を追加することを推奨します

### マージの実施

- **PRを作成しただけではマージされていません**
- GitHub UI でマージボタンをクリックするか、`/merge` コマンドのPRモードを使用してください

### PRを作らずに直接マージしたい場合

- `/merge` コマンドを使用して、"PRを作成しますか？" で No を選択してください
- Safe Mode または Fast Mode で直接マージできます

---

## トラブルシューティング

### "gh: command not found"

```bash
# macOS
brew install gh

# 認証
gh auth login
```

### "main ブランチから実行できません"

```bash
# 新しいsession/*ブランチを作成してください
git checkout -b session/$(date +%Y-%m-%d)-<type>-<name>
```

### "コミットがありません"

```bash
# 変更をコミットしてください
git add <files>
# /commit コマンドを使用（推奨）
```

### "すでにPRが存在します"

- 既存のPR URLが表示されるので、ブラウザで確認してください
- 追加のコミットをpushする場合:
  ```bash
  git push origin $CURRENT_BRANCH
  ```
  PRは自動的に更新されます

---

**関連コマンド**:
- `/commit`: コミット作成（決定記録）
- `/merge`: PRモードでマージまで実施

**関連Skill**:
- git-workflow: ブランチ戦略、PRワークフロー
- development-workflow: Phase 6 (Merge)
