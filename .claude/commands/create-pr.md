# PR作成コマンド（Jujutsu）

現在の Jujutsu workspace（session）から Pull Request を作成します。  
コミットメッセージからタイトル・ボディを自動生成し、ブラウザで開きます。

**用途**:
- PRを作成してレビュー依頼（マージはGitHub UIまたは `/merge`）
- CI/CDチェック、チーム協業

---

## 0. 前提チェック

実行前に以下を確認してください:
- `jj` が利用可能であること（`jj --version`）
- 現在workspaceが `default` 以外であること（session workspace想定）
- gh CLI がインストール済み（`gh --version`）
- GitHub認証済み（`gh auth status`）

---

## 1. workspace / session検出

```bash
if ! command -v jj &> /dev/null; then
  echo "Error: jj がインストールされていません"
  exit 1
fi

CURRENT_WS=$(jj workspace list 2>/dev/null | grep -E "^\*" | awk '{print $1}' || echo "")
if [ -z "$CURRENT_WS" ] || [ "$CURRENT_WS" = "default" ]; then
  echo "Error: session workspace から実行してください"
  exit 1
fi

SESSION_ID="$CURRENT_WS"
echo "✓ workspace: $SESSION_ID"
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
  if jj bookmark list "$candidate" --no-pager 2>/dev/null | grep -q "^$candidate:"; then
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
echo "📤 bookmark を push 中..."
jj git push --bookmark "$SESSION_ID"

COMMIT_COUNT=$(jj log -r "${DEFAULT_BRANCH}..${SESSION_ID}" -T '"x\n"' --no-pager --no-graph 2>/dev/null | wc -l | tr -d ' ')
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
  PR_TITLE=$(jj log -r "$SESSION_ID" -T 'description.first_line()' --no-pager | head -1)
else
  PR_TITLE="chore: merge $SESSION_ID"
fi

PR_BODY="$(cat <<EOF_BODY
## Summary

$(jj log -r "${DEFAULT_BRANCH}..${SESSION_ID}" -T '"- " ++ description.first_line() ++ "\\n"' --no-pager)

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
- `git push` ではなく `jj git push --bookmark` を使用する
- `default` workspace からは実行しない

---

**関連コマンド**:
- `/commit`: `jj describe + jj new` でコミット確定
- `/merge`: PR作成〜マージ〜workspace掃除まで実行
