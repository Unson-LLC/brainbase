# セッションマージ（PRモード）

session/* ブランチをデフォルトブランチへマージします。

**Jujutsu対応**: Jujutsu workspaceで作業している場合、自動的に検出して `jj` コマンドを使用します。

---

## 前提条件

- 現ブランチ: `session/*` であること
- 全てのコミット完了
- テスト通過済み
- gh CLI インストール済み (`gh --version`)
- GitHub認証完了 (`gh auth status`)

---

## 手順

> Note: 表示崩れ対策でコード例内の変数は `\$VAR` 表記にしています（実シェル実行時は `$VAR` として扱ってください）。

### 1. 前提確認 & モード検出

```bash
# Jujutsu workspace検出
IS_JJ_WORKSPACE=false
if command -v jj &> /dev/null && jj workspace list &> /dev/null 2>&1; then
  CURRENT_WS=\$(jj workspace list 2>/dev/null | grep -E "^\*" | awk '{print \$1}' || echo "")
  if [ -n "\$CURRENT_WS" ] && [ "\$CURRENT_WS" != "default" ]; then
    IS_JJ_WORKSPACE=true
    SESSION_ID="\$CURRENT_WS"
    echo "🥋 Jujutsu workspace detected: \$SESSION_ID"
  fi
fi

# デフォルトブランチ取得
DEFAULT_BRANCH=\$(git remote show origin | sed -n 's/.*HEAD branch: //p')
if [ -z "\$DEFAULT_BRANCH" ]; then
  echo "Error: デフォルトブランチを取得できませんでした"
  exit 1
fi

# ブランチ確認
CURRENT_BRANCH=\$(git branch --show-current)
if [[ ! "\$CURRENT_BRANCH" =~ ^session/ ]]; then
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

echo "✓ 前提確認完了 (Jujutsu: \$IS_JJ_WORKSPACE)"
```

### 2. リモートへpush（Jujutsu対応）

```bash
echo "📤 リモートへpush中..."

if [ "\$IS_JJ_WORKSPACE" = true ]; then
  # Jujutsuモード: jj git push
  echo "  Using Jujutsu..."
  jj git push --bookmark "\$SESSION_ID" 2>/dev/null || \
    jj git push --branch "\$CURRENT_BRANCH"
else
  # Gitモード: git push
  git push -u origin "\$CURRENT_BRANCH"
fi

echo "✓ Push完了"
```

### 3. PR作成

```bash
# コミット数取得
COMMIT_COUNT=\$(git rev-list --count \${DEFAULT_BRANCH}..HEAD)

# PR Title生成
if [ "\$COMMIT_COUNT" -eq 1 ]; then
  PR_TITLE=\$(git log -1 --format="%s")
else
  PR_TITLE="chore: merge \$CURRENT_BRANCH"
fi

# PR作成
gh pr create --base "\$DEFAULT_BRANCH" --title "\$PR_TITLE" --body "\$(cat <<EOF
## Summary

\$(git log \${DEFAULT_BRANCH}..HEAD --format="- %s")

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

if [ \$? -ne 0 ]; then
  echo "Error: マージに失敗しました"
  echo "GitHub UI でPRを確認してください: gh pr view --web"
  exit 1
fi

echo "✓ マージ完了"
```

### 5. ローカル同期 & Workspace削除

```bash
echo "🔄 ローカル同期中..."
git checkout "\$DEFAULT_BRANCH"
git pull origin "\$DEFAULT_BRANCH"
git fetch --prune
echo "✓ ローカル同期完了"

# Jujutsu workspace削除
if [ "\$IS_JJ_WORKSPACE" = true ]; then
  echo ""
  echo "🧹 Cleaning up Jujutsu workspace..."

  # state.jsonからセッション情報を削除（workspaceパスも取得）
  STATE_FILE="\${BRAINBASE_STATE_FILE:-/Users/ksato/workspace/shared/var/state.json}"
  WORKSPACE_PATH=""
  if [ -f "\$STATE_FILE" ] && command -v jq &> /dev/null; then
    # workspaceパスを取得してから削除
    WORKSPACE_PATH=\$(jq -r --arg sid "\$SESSION_ID" '.sessions[] | select(.id == \$sid or .workspace == \$sid) | .worktree.path // .workspacePath // empty' "\$STATE_FILE" 2>/dev/null | head -1)
    TMP_FILE="\${STATE_FILE}.tmp"
    jq --arg sid "\$SESSION_ID" '.sessions = [.sessions[] | select(.id != \$sid and .workspace != \$sid)]' \
      "\$STATE_FILE" > "\$TMP_FILE" 2>/dev/null && mv "\$TMP_FILE" "\$STATE_FILE"
    echo "  ✓ Updated state.json"
  fi

  # workspace削除（メタデータのみ）
  if jj workspace forget "\$SESSION_ID" 2>/dev/null; then
    echo "  ✓ Workspace metadata deleted: \$SESSION_ID"
  else
    echo "  ⚠️  Could not delete workspace metadata (may not exist)"
  fi

  # bookmark削除（リモートで削除済みの場合はローカルのみ）
  if jj bookmark delete "\$SESSION_ID" 2>/dev/null; then
    echo "  ✓ Bookmark deleted: \$SESSION_ID"
  fi

  # 物理ディレクトリ削除（jj workspace forgetはディスクを削除しない）
  if [ -n "\$WORKSPACE_PATH" ] && [ -d "\$WORKSPACE_PATH" ]; then
    rm -rf "\$WORKSPACE_PATH"
    echo "  ✓ Physical directory deleted: \$WORKSPACE_PATH"
  fi

  echo "✓ Jujutsu cleanup complete"
fi
```

### 7. 完了確認

```bash
echo ""
echo "✅ マージ成功！"
git log --oneline -3

if [ "\$IS_JJ_WORKSPACE" = true ]; then
  echo ""
  echo "🥋 Jujutsu session archived: \$SESSION_ID"
fi
```

---

## 注意

- `gh pr merge --merge` は CI完了後にマージ実行（GitHub側で制御）
- コンフリクト時は GitHub UI で手動解決が必要
- ブランチは自動削除されます（--delete-branch）
- **Jujutsu workspace**: マージ後に自動的にworkspaceとbookmarkが削除されます
