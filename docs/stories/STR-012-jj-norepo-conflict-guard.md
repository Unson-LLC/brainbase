---
story_id: STR-012
title: jj非リポジトリのworktreeでconflict検査warnを出さない
source_requirement:
  requirement_title: "brainbaseのLogノイズを減らし本物の異常を見えやすくする"
architecture_docs:
  - kind: adr_unnecessary
    reason: jj conflict 検査の catch に benign 判定を1つ足すだけで、アーキテクチャ・データフロー・永続化・公開APIに変更はない。純粋helper追加と既存catch分岐の差し替えに閉じる。
status: in_progress
created_at: 2026-06-02
updated_at: 2026-06-02
---

# STR-012: jj非リポジトリのworktreeでconflict検査warnを出さない

## 背景

brainbase の Loki に `[workspace] Failed to inspect conflicts for ...: Command failed: jj -R "..." resolve --list ... Error: There is no jj repo in "..."` が、特定の stale な worktree に対して数分おきに出続けていた。

`WorktreeService._hasWorkingCopyConflicts` は `jj resolve --list` を実行して working copy の conflict を検出する。jj リポジトリでない workspace（例: git-only の worktree）では jj が "There is no jj repo" で異常終了する。これは jj conflict が存在しない正当な状態だが、catch は "No conflicts found" だけを benign 扱いし、"no jj repo" は `logger.warn` に落ちてエラーログを汚していた。

## 誰が

brainbase の運用監視・ログ駆動の改善ループに依存する開発者として。

## 何を

jj リポジトリでない worktree に対する conflict 検査が、warn を出さず「conflict なし」として扱われる状態にしたい。本物の jj エラー（snapshot 失敗等）は従来どおり warn で可視化されてほしい。

## なぜ

正当な状態（非 jj worktree）に対する warn がエラーログを埋めると、本物の異常が埋もれる。conflict 検査は jj が無い workspace を benign に扱い、想定外のエラーだけを warn すべき。

## 受け入れ基準

- [ ] "There is no jj repo" 由来の失敗時、`_hasWorkingCopyConflicts` は warn せず false（conflict なし）を返す
- [ ] "No conflicts found" は従来どおり warn せず false を返す（既存挙動を維持）
- [ ] 上記以外の一般的な jj エラーは従来どおり `logger.warn` で記録する（warn を握り潰さない）
- [ ] VibePro dogfood run として Story -> Architecture -> Spec -> Test -> Code -> Run evidence が追跡できる

## スコープ外

- 非 jj worktree がそもそも生成・残置される原因の修正（別問題）。
- conflict 検査ロジック（`_resolveListHasConflicts`）の判定基準変更。
- jj/git worktree のライフサイクルや永続化スキーマの変更。

---

**ガードレール**: このファイルには仕様/実装詳細を書かない。背景・誰が・何を・なぜ・受け入れ基準のみ。
