# Spec: STR-010 reconciler transport-aware ttyd classification

Story: STR-010 / 受け入れ基準を検証可能な仕様句に落とす。

## 対象

`server/services/terminal-runtime-reconciler.js`:
- constructor の `terminalTransport`（既定 `process.env.BRAINBASE_TERMINAL_TRANSPORT`）
- `_isXtermTransport()`
- `_classifyRuntimeState()` の `stale_ttyd_process` 分岐の gate

## 契約 (Spec Clauses)

- SPEC-1 (ac:1): `terminalTransport === 'xterm'` のとき、`_classifyRuntimeState` は active + tmux 生存 + 永続 ttydProcess + 観測 ttyd 0 のセッションに対し `stale_ttyd_process` issue を出さず、runtimeState を degraded にしない。
- SPEC-2 (ac:2): `terminalTransport` が xterm 以外（ttyd 等）のとき、同条件で従来どおり `stale_ttyd_process` を出し degraded にする。
- SPEC-3 (ac:3): xterm transport で `reconcile({recover:true})` を実行しても、該当セッションに `reconnect_ttyd` アクションを生成・実行しない。
- SPEC-4 (ac:4): 本 Story は VibePro dogfood として Story -> Architecture -> Spec -> Test -> Code -> Run evidence が追跡できる。

## 不変条件 (workflow scenario)

- During the terminal reconciliation workflow, the PTY watchdog process drives a recover flow whose state transitions classify each active session; when the live transport is xterm the missing-ttyd status must resolve to a non-degraded state so the recover flow does not loop on ttyd reconnect.
- xterm transport の判定は reconciler 内に閉じ、lifecycle/maintenance の ttyd 前提コードには波及しない。

## 非目標

- `_isXtermOnlyMode()` env gate の修正、ttyd transport 挙動、永続レコードのクリーンアップは対象外。
