# セッションマージ（jj + PRモード）

セッションのworkspaceをmainへマージします（GitHub PR経由）。

---

## 前提条件

- jj workspaceでセッション作業中であること
- 全てのコミットに説明がついていること（`jj log` で確認）
- テスト通過済み
- gh CLI インストール済み (`gh --version`)
- GitHub認証完了 (`gh auth status`)

---

## 手順

### 1. 前提確認

```bash
# workspaceとworking copy確認
jj workspace list
jj log -r @ --no-pager

# 未説明のコミットがないか確認
jj log -r "::@" --no-pager -n 10

# gh CLI確認
gh auth status
```

### 2. bookmarkをpush

```bash
# セッションIDをbookmark名として使用
# bookmark が @ の親（describe済みコミット）を指していることを確認
jj log -r "bookmarks()" --no-pager

# リモートへpush
jj git push --bookmark <session-id>
```

### 3. PR作成

```bash
# mainとの差分確認
jj log -r "main..@-" --no-pager

# PR作成
gh pr create \
  --title "<type>: <summary>" \
  --body "$(cat <<'EOF'
## Summary

- 主な変更点

## Test plan

- [ ] 変更が意図通りに動作することを確認

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

### 4. GitHub経由マージ

```bash
gh pr merge --merge --delete-branch
```

### 5. ローカル同期 + ワークスペースクリーンアップ

```bash
# リモートの変更を取り込み
jj git fetch

# ワークスペースを忘れる（物理ディレクトリは残る）
jj workspace forget <workspace-name>

# bookmarkを削除
jj bookmark delete <session-id>
```

### 6. 完了確認

```bash
jj log -r "main" --no-pager -n 3
```

---

## API経由マージ（推奨）

上記手順はbrainbaseサーバーのAPIでも実行可能：

```bash
curl -X POST http://localhost:31013/api/sessions/<session-id>/merge
```

サーバー側の `worktreeService.merge()` が上記手順を一括実行する。

---

## 注意

- `gh pr merge --merge` は CI完了後にマージ実行（GitHub側で制御）
- コンフリクト時は GitHub UI で手動解決が必要
- ブランチは自動削除されます（--delete-branch）
- ワークスペースの物理ディレクトリは手動削除が必要な場合あり
