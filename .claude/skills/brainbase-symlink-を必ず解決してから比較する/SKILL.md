---
name: brainbase-symlink-を必ず解決してから比較する
description: symlink を必ず解決してから比較する
---

# brainbase-symlink-を必ず解決してから比較する

## Trigger
- Use when this pattern appears: symlink を必ず解決してから比較する

## Steps
- **許可判定を絶対パスの親子関係でやる**
- `home配下ならOK` みたいな雑ルールはやめる
- 許可済み roots を配列で持つ
- 例: `workspaceRoot`, `brainbaseRoot`, `projectsRoot`, `active session.path`, `active session.worktree.path`
- `realpath()` で解決したあとに「どれかの配下か」で判定する
- **symlink を必ず解決してから比較する**
- 比較前に `fs.realpathSync()` で `cwd` と `targetPath` と `allowedRoots` を全部正規化
- これやらないと symlink 経由だけ通る/落ちる、みたいな事故が出る
- **`cwd` 単体を信用しない**
- クライアントから来た `cwd` はヒント扱いにする
- 本命は `sessionId` からサーバー側でセッションの実パスを引くこと
- つまり `open-file` は ideally `path + sessionId` を受けて、`cwd` は server が決める
- **相対パス優先にする**
- terminal から選ばれた文字列が相対なら、まず session root 基準で解決
- 絶対パスは「許可 roots 配下ならOK」に限定
- こうするとログ出力の表記揺れに強い
- **許可 roots を設定化する**
- コードに `/workspace/` 文字列埋め込みはやめる
- config で `allowedPathRoots` を持てるようにする
- デフォルトは
- current repo root
- configured projects root
- known session/worktree roots
- 必要ならユーザー環境で外部SSDを追加できる
- **deny by default + diagnostics を出す**
- 拒否は維持でいい
- ただしエラー文を
- `resolvedTarget`
- `resolvedBase`
- `matchedAllowedRoot: none`
- そうすると次の環境差分で秒で詰められる
- **テストで環境差分を固定する**
- 少なくともこれを API テストに入れる
- `/Users/...` の通常ディレクトリ
- `/Volumes/...` の外部SSD想定パス
- symlink 経由の workspace
- relative path + session root
- absolute path inside allowed root
- absolute path outside allowed root
- `..` traversal
- broken symlink

## Guardrails
- Do not override the linked wiki rule.
- Escalate if the current case contradicts the wiki guidance.

## Linked Wiki
- stories/symlink-を必ず解決してから比較する

## Source
- Promoted from codex_session_log / success