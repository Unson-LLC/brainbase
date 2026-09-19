---
name: worktree-dev-server
description: Codex所有のworktreeで、目的・ポート・データ分離を確認して開発サーバーを扱う。
---

# worktreeの開発サーバー

正本: `docs/architecture/ADR-019-codex-owns-development-runtime.md`。旧BrainbaseブラウザUIは廃止済みです。サーバー起動は必要なAPI検証に限り、対象テストだけで検証できる場合は起動しません。

1. repo、branch、dirty状態、起動目的を確認する。worktree作成は `branch-worktree-rules` に従い、外付け `CODEX_WORKTREE_ROOT` を使う。内部ディスクへfallbackしない。
2. `package.json` の実際の起動コマンドと環境変数を確認する。依存はlockfileに従って解決する。
3. 31013はcanonical runtimeとして使用しない。候補ポートのlistenerを確認し、競合なら別のポートを選ぶ。既存プロセスを停止して空けない。
4. データ、認証、外部接続が本番と分離されていることを対象のtest fixture/runbookで確認する。`PORT`変更だけでデータが隔離されると判断しない。個人ホームや本番 `_sessions` 等のコピーはしない。
5. 明示的に指定した開発設定でCodexのterminal/process管理から起動し、PID/cwd・health・必要なAPI応答を確認する。旧UIを開かない。
6. 停止は起動時のプロセスハンドルを使う。ポートだけ、古いPIDファイルだけ、プロセス名だけの一括killはしない。一時データ削除は今回作成した対象・所有者を確認してから行う。

canonical runtimeの確認が必要なら `brainbase-capability-map` の `runtime.launchd` を参照する。開発サーバー操作から本番更新・再起動へ範囲を広げない。
