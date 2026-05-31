---
story_id: story-session-switch-connect-hang
title: Session switch never hangs — superseded terminal connect settles deterministically
status: active
source_requirement:
  type: user_report
  detail: >
    セッション切り替えのパフォーマンス計測中、サスペンド/再接続が絡むと切替が
    30〜76s、ときに5分以上ハングし ok:false になる事象を観測。原因は
    terminal-transport-client.js connect() の orphaned promise。
architecture_docs:
  - path: docs/specs/story-session-switch-connect-hang-spec.md
    status: referenced
    reason: connect() を必ず settle する内部修正と switchSession の snapshot_fallback stale-guard 追加のみ。新規モジュール境界・依存・データフロー・公開API・イベント契約の変更はなく既存 TerminalTransportClient / switchSession ステートマシン内で完結する。
---

## Background

`switchSession` (`session-management-mixin.js`) の desktop xterm 経路は、snapshot を
即表示して overlay を畳んだ後、バックグラウンドで `_connectXtermTransport` →
`terminalTransportClient.connect()` を await する。`connect()` には
`CONNECT_TIMEOUT_MS = 15000` のタイムアウトがあるが、タイムアウト callback と
`settle()` の両方が `this._connectToken !== connectToken` でガードされている。

reconnect / visibility 由来の `connect()`（`_scheduleReconnect`, line 426, 1399 等）が
pending 中に `_connectToken` を bump すると、先行 connect の timeout は no-op になり、
その Promise は **二度と settle しない**。await している `switchSession` は永久に返らず、
凍った snapshot が live に見えたまま `transport:'reconnecting'` が続く（実測 >5分）。

## Scope

- `connect()` を「必ず settle する」契約にする。supersede された pending connect は
  `superseded` として reject し、既存の `_connectXtermTransport` catch →
  `switchSession` の `snapshot_fallback` 経路（degraded だが復帰可能）を走らせる。
- connect 完了/失敗/supersede/timeout の毎回、`_lastConnectMetric`（outcome + durationMs）
  を publish し、これまで不可視だった connect フェーズを計測可能にする。
- out of scope: 切替速度そのものの最適化（warm 持続接続化）、cold runtime resume の改善。

### 変更しない既存分岐（out of scope, 本 Story では挙動不変）

本修正は `switchSession` / `_resumeSuspendedRuntimeIfNeeded` と同じファイルに触れるが、
以下の既存分岐は**意図的に変更しない**（挙動は従来どおり）。本 Story の受け入れ基準は
connect() の hang 解消と stale-guard に限定する。

- `session.intendedState === 'archived'`: アーカイブ済みセッションは従来どおり
  `switchSession` の冒頭で短絡し `{ ok: true, archived: true }` を返す。connect も transport も張らない。
- `session?.intendedState === 'broken'`: 壊れた runtime は従来どおり
  `_resumeSuspendedRuntimeIfNeeded` が `{ ok: false }`（明示的な復旧が必要）を返す。

これらは hang や supersede とは独立の経路であり、本修正の対象外（回帰なし）。

## Acceptance Criteria

- [x] A superseded connect (a concurrent or reconnect connect bumps the token while the first connect is still pending) rejects deterministically as superseded instead of hanging, so the awaiting switch reaches the snapshot fallback instead of freezing forever.
- [x] A non-superseded connect that never receives ready still rejects at CONNECT_TIMEOUT_MS, preserving the existing connect timeout for the un-superseded case.
- [x] Every connect settle publishes a _lastConnectMetric carrying the outcome and a numeric durationMs, making the previously invisible connect phase observable.

## Verification

- `tests/unit/terminal-transport-connect-supersede.test.js` — deterministic orphan repro
  (NeverReadyWebSocket + double connect → first promise rejects superseded within a 400ms
  wall-clock guard), CONNECT_TIMEOUT_MS regression guard (fake timers), and live-outcome
  metric assertion.
- Existing `tests/unit/terminal-transport-client.test.js` (96) + reconnect + snapshot-handoff
  suites stay green (no behavioral regression to the happy path).
