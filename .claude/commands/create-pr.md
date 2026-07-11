# PR作成コマンド

現在の git worktree（session）から Pull Request を作成します。
コミットメッセージからタイトル・ボディを自動生成し、ブラウザで開きます。

**用途**:
- PRを作成してレビュー依頼（マージはGitHub UIまたは `/merge`）
- CI/CDチェック、チーム協業

---

## 0. 前提チェック

実行前に以下を確認してください:
- `git` が利用可能であること（`git --version`）
- 現在のブランチが develop/main 以外であること（session worktree想定）
- gh CLI がインストール済み（`gh --version`）
- GitHub認証済み（`gh auth status`）

---

## 1. ブランチ / session検出

```bash
if ! command -v git &> /dev/null; then
  echo "Error: git がインストールされていません"
  exit 1
fi

CURRENT_WS=$(git branch --show-current)
if [ -z "$CURRENT_WS" ] || [ "$CURRENT_WS" = "main" ] || [ "$CURRENT_WS" = "develop" ]; then
  echo "Error: session worktree（feature branch）から実行してください"
  exit 1
fi

SESSION_ID="$CURRENT_WS"
echo "✓ branch: $SESSION_ID"
```

---

## 2. gh CLI / 認証確認

```bash
if ! command -v gh &> /dev/null; then
  echo "Error: gh CLI がインストールされていません"
  echo "インストール: brew install gh"
  exit 1
fi

if ! gh auth status &> /dev/null; then
  echo "Error: GitHub認証が必要です"
  echo "実行: gh auth login"
  exit 1
fi
```

---

## 3. デフォルトブランチ取得

```bash
DEFAULT_BRANCH=""
for candidate in main master develop; do
  if git ls-remote --exit-code --heads origin "$candidate" &>/dev/null; then
    DEFAULT_BRANCH="$candidate"
    break
  fi
done
[ -z "$DEFAULT_BRANCH" ] && DEFAULT_BRANCH="main"

echo "✓ default branch: $DEFAULT_BRANCH"
```

---

## 4. push & 変更確認

```bash
echo "📤 branch を push 中..."
git push -u origin "$SESSION_ID"

COMMIT_COUNT=$(git log --oneline "origin/${DEFAULT_BRANCH}..${SESSION_ID}" 2>/dev/null | wc -l | tr -d ' ')
if [ "${COMMIT_COUNT:-0}" -eq 0 ]; then
  echo "Error: PR対象コミットがありません"
  echo "先に /commit を実行してください"
  exit 1
fi

echo "✓ コミット数: $COMMIT_COUNT"
```

---

## 5. PRタイトル / ボディ生成

```bash
if [ "$COMMIT_COUNT" -eq 1 ]; then
  PR_TITLE=$(git log -1 --format='%s' "$SESSION_ID")
else
  PR_TITLE="chore: merge $SESSION_ID"
fi

PR_BODY="$(cat <<EOF_BODY
## Summary

$(git log --format='- %s' "origin/${DEFAULT_BRANCH}..${SESSION_ID}")

## Test plan

- [ ] 全てのテストが通ることを確認
- [ ] 変更が意図通りに動作することを確認

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF_BODY
)"
```

---

## 6. PR作成（ブラウザで開く）

```bash
echo "🔧 PR作成中..."

gh pr create \
  --base "$DEFAULT_BRANCH" \
  --head "$SESSION_ID" \
  --title "$PR_TITLE" \
  --body "$PR_BODY" \
  --web
```

---

## 注意事項

- PR作成のみ。マージは `/merge` または GitHub UIで実施
- `git push -u origin <branch>` で feature branch を push する
- `main` / `develop` ブランチからは実行しない

---

**関連コマンド**:
- `/commit`: `git add -A + git commit` でコミット確定
- `/merge`: PR作成〜マージ〜worktree掃除まで実行
