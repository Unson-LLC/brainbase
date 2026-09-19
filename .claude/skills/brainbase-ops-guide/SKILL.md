---
name: brainbase-ops-guide
description: "Brainbase Coreの運用を現行capabilityと専用Skillへ振り分ける入口"
---

# Brainbase運用ガイド

旧Web UI時代の統合手順は廃止した。個人の絶対パス、旧session DB、古いlaunchd名を現行正本として扱わない。

## 最初に確認すること

- BrainbaseはGraph、Automation、認証、接続、receiptを担当する。開発タスク・worktree・terminalはCodex app/CLIの責任。
- sessionの旧SQLite/JSONは凍結された移行証跡。編集や旧APIでの復元をしない。
- `BRAINBASE_STATE_PATH` は互換の保存先解決に残るが、session状態のwriterではない。`lib/runtime-paths.js` と実行中プロセスの設定を確認する。
- 稼働中プロセスやworktreeを一括停止・一括移動しない。対象PID、cwd、所有者、dirty状態を確認する。
- PRのマージ、本番配備、再起動、利用者側の動作確認は別の完了条件。マージだけで稼働反映済みとは言わない。

## 作業別の参照先

| 作業 | 最初に読む現行手順 |
|---|---|
| runtimeの起動元・ポート・launchd | `docs/brainbase-capabilities/capabilities/runtime.launchd.yml` とリンク先runbook |
| 環境変数・秘密情報 | `.claude/skills/brainbase-infisical-env-management/SKILL.md` |
| Git・PR・worktree | `.claude/skills/git-workflow/SKILL.md`、`.claude/skills/branch-worktree-rules/SKILL.md` |
| 作業用サーバー | `.claude/skills/worktree-dev-server/SKILL.md` |
| 能力・認証・プロジェクト一覧 | `.claude/skills/brainbase-capability-map/SKILL.md` |
| 旧開発セッションの扱い | `docs/architecture/ADR-019-codex-owns-development-runtime.md` |

選んだ手順本文を読み、実設定と照合してから実行する。この入口は設定値や手順の複製を持たない。
