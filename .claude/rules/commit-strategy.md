# Commit Strategy

brainbase の正本ワークフローは `jj` です。`git commit` ではなく、現在の working copy に説明をつけて確定します。

## 原則

- 1つの意図 = 1コミット
- 「実装した」と返した変更は、そのまま次タスクへ進めない
- dirty な変更がある状態で、同じファイルへ別意図の変更を重ねない

## 必須フロー

1. 変更したら `jj diff --stat` で確認する
2. 意図が1つに閉じているなら `jj describe -m "..."` を実行する
3. 次の意図に進む前に `jj new` を実行する

## 危険な状態

以下の状態は放置禁止です。

- `jj workspace list` で現在の `@` が `(no description set)` のまま
- `jj diff --stat` に変更が残っている
- そのまま別ファイルの修正や別バグ調査に進む

## 同一ファイル再編集ルール

同じファイルを再度触る前に、最低限これを確認する。

```bash
jj diff --stat
jj diff <path>
```

すでに dirty な変更がそのファイルに残っている場合:

- 同じ意図なら、その変更の上に積む
- 別意図なら、先に `jj describe` + `jj new` で切る

## 強制ガード

session shell では `jj` wrapper が有効になっており、以下は dirty かつ `(no description set)` の状態では失敗します。

- `jj new`
- `jj rebase`
- `jj edit`
- `jj split`
- `jj squash`
- `jj abandon`
- `jj git push`
- `jj workspace add/forget/rename`
- `jj bookmark set/move/delete/forget/rename`

## 例

```bash
jj diff --stat

jj describe -m "$(cat <<'EOF'
fix: セッションインジケータの色を整理

なぜ:
- working と waiting の意味を視覚的に分けたかった

変更:
- working を青へ変更
- waiting と input badge をオレンジへ統一

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"

jj new
```
