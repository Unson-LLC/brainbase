---
name: ttyd-websocket-troubleshooting
description: "廃止済みBrainbase ttyd接続の境界を確認し、所有アプリへ案内する"
---

# Brainbase ttyd接続は廃止済み

ADR-019によりBrainbaseのterminal transport、session作成・停止・再接続は廃止した。
旧ttyd再起動APIや全セッション一括再起動の手順を実行しない。
Codex app/CLIが開発タスクとterminal/processの所有者であり、Brainbaseはそれらを再生成しない。

1. 対象のアプリ、タスク、接続先と実際のエラーを確認する。
2. 旧Brainbase WebのURLなら、退役境界を説明し、所有アプリで対象タスクを確認する。
3. 他製品が独自に使うttydなら、その製品の設定・ログ・手順を確認する。旧Brainbaseの原因や修正を流用しない。
4. 既存プロセスを停止する前に所有者・PID・cwd・影響範囲と権限を確認する。一括停止しない。

正本: `docs/architecture/ADR-019-codex-owns-development-runtime.md`
退役契約: `docs/brainbase-capabilities/capabilities/terminal.transport.yml`
旧実装の記録はGit履歴で参照できる。歴史的な起動時間や成功率は現在の動作の証拠ではない。
