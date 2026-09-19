---
adr_id: ADR-019
title: Codex owns task, worktree, and terminal lifecycle
status: accepted
date: 2026-07-24
supersedes:
  - docs/architecture/session-hibernation-mvp-architecture.md
  - docs/architecture/codex-app-server-adapter-architecture.md
related_docs:
  - docs/architecture/ADR-017-agent-first-product-surface.md
  - docs/architecture/brainbase-web-surface-retirement-inventory.md
---

# ADR-019: Codex owns task, worktree, and terminal lifecycle

## Context

Brainbaseのsession、worktree、PTY/tmux/ttyd、Codex App Server連携は、BrainbaseがCodexアプリ相当のWeb UIを提供していた時代の実装である。ADR-017でBrainbase Webを標準操作面から外した後も、この実装はworktree状態の監視、復旧、archive、merge、削除を継続し、CodexとBrainbaseの二重所有を作っていた。

## Decision

- task/thread、worktree、branch状態、dirty/unpushed判定、terminal/PTY、実行プロセスのライフサイクルはCodex app/CLIが所有する。
- Brainbaseはこれらの可変状態を作成、復旧、監視、hibernate、archive、merge、削除しない。
- BrainbaseはGraph、Automation Run、Run Receipt、MCP、認証、外部接続、監査、学習のControl Planeに集中する。
- 過去のsession/archive記録は移行証跡として保護し、active lifecycleへ戻さない。由来確認なしに削除しない。
- Brainbaseが必要とする実行証跡は、worktree状態ではなく、外部runtimeが確定したRun Receiptとして受け取る。

## Runtime boundary

```text
Codex app / CLI
  task + thread + worktree + git status + terminal + process lifecycle

Brainbase
  Graph + automation contracts + receipts + auth + connectors + audit
```

## Migration

1. [完了] session/worktree/terminalのwriterと自動reconcileを停止し、旧endpointを`410 Gone`にする。
2. [完了] 過去レコードをread-only evidenceとして凍結する。
3. [完了] active composition rootから旧runtimeを除去し、未参照のserver controller/service/route、tmux/PTY起動script、session activity hookと専用testを物理削除した。旧ブラウザの残存資材と専用テストも除去し、capability文書を現役API/CLIの責任へ整合した。範囲と保護対象は[残存整理の検証](../verification/legacy-surface-completion.md)を参照。本番配備の完了を意味しない。
4. [完了] Coreの起動、health、open-file、shutdownからsession/worktree/terminal依存を除去した。legacy stateはactive runtimeでload/saveせず、移行証跡として物理ファイルだけを保護する。
5. [完了] 未参照のSQLite/JSON state storeと専用controller/route/test、旧hibernate smoke scriptを除去した。rootの旧`setup.sh`は実行を停止し、`npm run setup`の案内だけを返す。保存済みDB/JSONを変更・削除しない。対象と検証は[状態管理の退役と障害回復](session-state-canonical-recovery.md)を参照。

## Verification

- 起動時にworktree cleanup、session restore、PTY watchdog、stale recycler、archive finalizerを実行しない。
- `/api/state`、`/api/sessions`、`/api/terminal`、`/api/brainbase/worktrees`、`/console`は`410 Gone`を返す。
- session/terminal WebSocket upgrade handlerを登録しない。
- shutdown時にBrainbaseがsession runtime processを停止しない。
- shutdown時にlegacy state storeを保存せず、既存session/archiveデータを削除・書換しない。
- `server.js`とbootstrap composition rootがsession/worktree/terminal lifecycle serviceをimport・生成しない。
- Claude/Codex hookがBrainbaseへsession activity heartbeatを送信しない。
