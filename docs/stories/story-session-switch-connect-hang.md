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
  - DESIGN.md
  - docs/specs/story-session-switch-connect-hang-spec.md
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
