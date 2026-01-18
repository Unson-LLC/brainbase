# セッションマージ（PRモード）

session/* ブランチを main へマージします。

---

## 前提条件

- 現ブランチ: `session/*` であること
- 全てのコミット完了
- テスト通過済み
- gh CLI インストール済み (`gh --version`)
- GitHub認証完了 (`gh auth status`)

---

## 手順

### 1. 前提確認

```bash
# ブランチ確認
CURRENT_BRANCH=$(git branch --show-current)
if [[ ! "$CURRENT_BRANCH" =~ ^session/ ]]; then
  echo "Error: session/* ブランチから実行してください"
  exit 1
fi

# gh CLI確認
if ! command -v gh &> /dev/null; then
  echo "Error: gh CLI がインストールされていません"
  echo "インストール: brew install gh"
  exit 1
fi

# GitHub認証確認
if ! gh auth status &> /dev/null; then
  echo "Error: GitHub認証が必要です"
  echo "実行: gh auth login"
  exit 1
fi

echo "✓ 前提確認完了"
```

### 2. リモートへpush

```bash
echo "📤 リモートへpush中..."
git push -u origin "$CURRENT_BRANCH"
echo "✓ Push完了"
```

### 3. PR作成

```bash
# コミット数取得
COMMIT_COUNT=$(git rev-list --count main..HEAD)

# PR Title生成
if [ "$COMMIT_COUNT" -eq 1 ]; then
  PR_TITLE=$(git log -1 --format="%s")
else
  PR_TITLE="chore: merge $CURRENT_BRANCH"
fi

# PR作成
gh pr create --title "$PR_TITLE" --body "$(cat <<EOF
## Summary

$(git log main..HEAD --format="- %s")

## Test plan

- [ ] 変更が意図通りに動作することを確認

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"

echo "✓ PR作成完了"
```

### 4. GitHub経由マージ

```bash
echo "🔀 GitHub経由でマージ中..."
gh pr merge --merge --delete-branch

if [ $? -ne 0 ]; then
  echo "Error: マージに失敗しました"
  echo "GitHub UI でPRを確認してください: gh pr view --web"
  exit 1
fi

echo "✓ マージ完了"
```

### 5. ローカル同期

```bash
echo "🔄 ローカル同期中..."
git checkout main
git pull origin main
git fetch --prune
echo "✓ ローカル同期完了"
```

### 6. 完了確認

```bash
echo ""
echo "✅ マージ成功！"
git log --oneline -3
```

---

## 注意

- `gh pr merge --merge` は CI完了後にマージ実行（GitHub側で制御）
- コンフリクト時は GitHub UI で手動解決が必要
- ブランチは自動削除されます（--delete-branch）
