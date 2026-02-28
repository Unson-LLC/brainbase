# deploy-merged-pr

PRマージ後にサーバーworkspaceを更新し、必要に応じて再起動するコマンド。

## トリガー

- `/deploy-merged-pr`
- ユーザーが「PRマージした」「developに反映して」「サーバー更新」などと言及

## 実行フロー

### Phase 1: Workspace更新

```bash
cd /Users/ksato/workspace/code/brainbase
jj git fetch
jj rebase -b default@ -d develop
```

### Phase 2: 変更内容の確認

```bash
# マージされたPRの変更ファイルを確認
jj diff -r 'default@^::default@' --stat
```

### Phase 3: 再起動判定

**再起動が必要な変更：**
- `server/` 配下のファイル変更
- `brainbase-ui/index.js` 等のサーバーエントリーポイント
- `package.json` の依存関係変更

**再起動不要な変更：**
- `public/` 配下のみの変更（フロントエンドのみ）
- `docs/` 配下のドキュメント変更
- `tests/` 配下のテストコード変更（サーバー動作に影響なし）

### Phase 4: 再起動実行（必要な場合のみ）

```bash
# アクティブセッション数を確認
tmux list-sessions 2>/dev/null | wc -l

# ユーザーに確認
echo "XX個のセッションがアクティブです。サーバーを再起動しますか？"

# 承認後
launchctl kickstart -k gui/$(id -u)/com.brainbase.ui

# 起動確認
sleep 3
curl -s http://localhost:31013/ | head -5
```

### Phase 5: 完了通知

```bash
# 再起動した場合
echo "✅ サーバーworkspace更新完了 & 再起動完了"
echo "ブラウザをリロードしてください"

# 再起動不要な場合
echo "✅ サーバーworkspace更新完了（再起動不要）"
echo "フロントエンドのみの変更の場合は、ブラウザをリロードしてください"
```

## 使用例

```bash
# ユーザー: "PR #56マージしたから、サーバーに反映して"
Claude: /deploy-merged-pr を実行

# 1. workspace更新
# 2. server/services/session-monitor.js が変更されていることを確認
# 3. 再起動が必要と判定
# 4. アクティブセッション数を確認: 16個
# 5. ユーザーに確認 → 承認
# 6. サーバー再起動
# 7. 起動確認
# 8. "✅ サーバーworkspace更新完了 & 再起動完了"
```

## 注意事項

- **コンフリクトが発生した場合**: 手動解決が必要
- **複数PRを連続でマージした場合**: 1回の実行で全て反映される
- **default@以外のworkspace**: このコマンドはサーバーのworkspace（default@）のみを更新

## 関連

- `git-workflow` Skill - /merge コマンド
- `brainbase-ops-guide` Skill - サーバー再起動手順
