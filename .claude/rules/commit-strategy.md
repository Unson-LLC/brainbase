# Commit Strategy

brainbase の正本ワークフローは `git` です。変更したファイルを明示的に `git add` し、`git commit` で確定します。

## 原則

- 1つの意図 = 1コミット
- 「実装した」と返した変更は、そのまま次タスクへ進めない
- dirty な変更がある状態で、同じファイルへ別意図の変更を重ねない
- `git add -A` / `git add .` は禁止。意図に対応するファイルを明示的に `git add <path>` する

## 必須フロー

1. 変更したら `git status` / `git diff --stat` で確認する
2. 意図が1つに閉じているなら、対象ファイルを明示的に `git add <path>` してから `git commit -m "..."` を実行する
3. 次の意図に進む前に、working tree がクリーンであることを確認する

## 危険な状態

以下の状態は放置禁止です。

- `git status` で未コミットの変更が残ったまま次の意図に進む
- `git diff --stat` に複数意図の変更が混在している
- そのまま別ファイルの修正や別バグ調査に進む

## 同一ファイル再編集ルール

同じファイルを再度触る前に、最低限これを確認する。

```bash
git status --porcelain
git diff <path>
```

すでに未コミットの変更がそのファイルに残っている場合:

- 同じ意図なら、その変更の上に積む
- 別意図なら、先に `git add <path>` + `git commit` で切ってから次に進む

## 強制ガード

破壊的操作（`git reset --hard`、`git checkout --`、`git clean` 等）を実行する前は、必ず `git status` で未コミットの変更がないか確認し、あればコミットまたは `git stash -u` で退避する。

- `git add -A` / `git add .`
- `git commit --no-verify`
- `git push --force`（明示的な合意なしに使用禁止）
- `git reset --hard`（未確認の変更がある状態での実行禁止）

## 例

```bash
git status --porcelain
git diff --stat

git add public/modules/session-indicator.js

git commit -m "$(cat <<'EOF'
fix: セッションインジケータの色を整理

なぜ:
- working と waiting の意味を視覚的に分けたかった

変更:
- working を青へ変更
- waiting と input badge をオレンジへ統一

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```
