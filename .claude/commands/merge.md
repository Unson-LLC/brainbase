# セッションマージ（Brainbase API 経由）

セッションのworkspaceをbase branchへマージします。Brainbase セッションのマージは、原則として Brainbase API を正本の実行経路にします。

## 最重要ルール

`マージして` と依頼された対象が Brainbase のセッション / worktree の場合、AI は `gh pr merge` や `jj git push` を直接組み合わせず、まず Brainbase API を使う。

```bash
curl -s -X POST http://localhost:31013/api/sessions/<session-id>/merge
```

理由:

- server側の `worktreeService.merge()` が PR作成、マージ、workspace cleanup を一括で実行する
- Brainbase 正本 repo の場合は merge 後に canonical workspace deploy guard も通る
- raw `gh` / `jj` 経路を使うと、PR merge 済みなのに 31013 が読んでいる `default@` に反映されない事故が再発する

---

## 前提条件

- jj workspaceでセッション作業中であること
- 全てのコミットに説明がついていること（`jj log` で確認）
- テスト通過済み
- gh CLI インストール済み (`gh --version`)
- GitHub認証完了 (`gh auth status`)

---

## 手順

### 1. session-id を特定

```bash
curl -s http://localhost:31013/api/state | jq '.sessions[] | {id, name, path, worktree}'
```

現在の cwd が session worktree の場合は、path / worktree.path と照合して該当 session-id を決める。

### 2. APIでマージ

```bash
curl -s -X POST http://localhost:31013/api/sessions/<session-id>/merge | jq
```

成功条件:

- `success: true`
- `prUrl` が返る
- Brainbase 正本 repo の場合、`deployGuard.success` が true

### 3. 完了確認

```bash
curl -s http://localhost:31013/api/sessions/<session-id>/archive-status | jq
curl -s http://localhost:31013/api/health | jq
```

必要なら `git ls-remote origin refs/heads/develop` と `jj log -r develop@origin` で origin/develop も確認する。

## 直接 gh / jj を使ってよい例外

- Brainbase API が停止している
- `/api/sessions/<id>/merge` が 5xx / 409 を返し、API経由では復旧できない
- ユーザーが明示的に GitHub CLI 直操作を指定している

例外経路を使った場合でも、最後に `/deploy-merged-pr` 相当の確認を行い、31013 の起動元と health を確認する。

## 旧手順の扱い

過去の `jj git push -> gh pr create -> gh pr merge -> workspace forget` は、Brainbase API の内部実装として扱う。AI が手作業で再現する標準手順にはしない。

---

## 注意

- `gh pr merge --merge` は CI完了後にマージ実行（GitHub側で制御）
- コンフリクト時は GitHub UI で手動解決が必要
- ブランチは自動削除されます（--delete-branch）
- ワークスペースの物理ディレクトリは手動削除が必要な場合あり
