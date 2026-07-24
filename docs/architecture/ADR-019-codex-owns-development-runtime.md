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
3. [進行中] active composition rootから旧runtimeを除去した。未参照の旧UI、controller、service、test、capability文書は依存順に削除する。
4. [完了] Coreの起動、health、open-file、shutdownからsession/worktree/terminal依存を除去した。legacy stateはactive runtimeでload/saveせず、移行証跡として物理ファイルだけを保護する。

## Verification

- 起動時にworktree cleanup、session restore、PTY watchdog、stale recycler、archive finalizerを実行しない。
- `/api/state`、`/api/sessions`、`/api/terminal`、`/api/brainbase/worktrees`、`/console`は`410 Gone`を返す。
- session/terminal WebSocket upgrade handlerを登録しない。
- shutdown時にBrainbaseがsession runtime processを停止しない。
- shutdown時にlegacy state storeを保存せず、既存session/archiveデータを削除・書換しない。
- `server.js`とbootstrap composition rootがsession/worktree/terminal lifecycle serviceをimport・生成しない。
