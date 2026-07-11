# deploy-merged-pr

PRマージ後にサーバーが読む正本checkout（develop）を更新し、必要に応じて再起動するコマンド。

## トリガー

- `/deploy-merged-pr`
- ユーザーが「PRマージした」「developに反映して」「サーバー更新」などと言及

## 実行フロー

### Phase 1: 正本checkout更新（git）

```bash
cd /Users/ksato/workspace/code/brainbase

# 反映前のHEADを控える（Phase 2の差分確認に使う）
BEFORE=$(git rev-parse HEAD)

# dirtyなら中断（正本checkoutに作業を残さない）
git status --porcelain | grep -vE '^\?\? (\.claude/|node_modules/|\.DS_Store)' && { echo "❌ 正本checkoutがdirty。先に退避/整理してください"; }

git fetch origin
git checkout develop 2>/dev/null || git checkout -B develop origin/develop
git merge --ff-only origin/develop
```

- `--ff-only` が失敗した場合はローカルにdevelopへの直接コミットが混入している。原因を特定するまで `reset --hard` しない。

### Phase 2: 変更内容の確認

```bash
git diff --stat "$BEFORE"..HEAD
git log --oneline "$BEFORE"..HEAD
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
echo "✅ 正本checkout更新完了 & 再起動完了"
echo "ブラウザをリロードしてください"

# 再起動不要な場合
echo "✅ 正本checkout更新完了（再起動不要）"
echo "フロントエンドのみの変更の場合は、ブラウザをリロードしてください"
```

## 注意事項

- **`--ff-only` 失敗時**: 正本checkoutに直接コミットが混入している。ログを確認し、必要ならセッションブランチへ退避してから揃える
- **複数PRを連続でマージした場合**: 1回の実行で全て反映される
- **正本checkout以外のworktree**: このコマンドはサーバーが読む正本checkout（develop）のみを更新する
- **デプロイガード**: サーバー側の `getMergeDeploymentGuardStatus` が「HEADとorigin/developの不一致」「dirty」を検知して merge deployment を止める。このコマンドはそのガードを通すための正規手順

## 関連

- `git-workflow` Skill - /merge コマンド
- `brainbase-ops-guide` Skill - サーバー再起動手順
