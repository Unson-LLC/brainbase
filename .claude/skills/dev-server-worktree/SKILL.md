---
name: dev-server-worktree
description: 退役した開発環境コピー機能を実行せず、Codex所有の明示的な開発手順へ案内する。
version: 2.0.0
trigger: /dev-server-worktree
---

# 旧開発環境コピー機能は廃止済み

このSkillから旧スクリプトを実行しません。ADR-019により開発session、worktree、プロセスはCodexが所有します。

- 本番データや履歴の `_sessions`、`_tasks` をコピーしない。
- 旧ブラウザUIを起動しない。現在のHTTPサーバーは旧開発画面の代替ではない。
- 開発サーバーが必要なら `worktree-dev-server` 手順に従い、起動対象・空きポート・隔離設定を確認して明示的に起動する。
- 停止は起動したCodexのプロセスハンドルを使う。ポートのみや古いPIDファイルを根拠にkillしない。
- 旧起動/停止スクリプトは廃止案内を出して非zero終了する。再有効化しない。

正本: `docs/architecture/ADR-019-codex-owns-development-runtime.md`。
