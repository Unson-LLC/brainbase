---
story_id: story-session-switch-auth-nonblocking
title: Session switch — remove blocking auth verify from the connect critical path
status: active
source_requirement:
  type: user_report
  detail: >
    warm セッション切替が ~2.35s。VibePro Graphify+位相分解 baseline で connect が 78%、
    そのうち GET /api/auth/verify の await が ~847ms 中央値（結果は破棄）と判明。
architecture_docs:
  - path: docs/adr/ADR-warm-session-switch.draft.md
    status: referenced
    reason: connect() 内の best-effort 認証 verify を await から fire-and-forget へ変える1行修正。新規モジュール境界・依存・データフロー・公開API・イベント契約の変更はなく既存 TerminalTransportClient 内で完結する。
---

## Background

VibePro の Graphify 影響マップ + クリーンな位相分解 baseline（`docs/adr/ADR-warm-session-switch.draft.md`）
で、warm セッション切替 ~2.35s の **connect が 78%** を占め、その内訳に
`connect()` 冒頭の `await this._ensureAuthenticated()`（= `GET /api/auth/verify`）が
**~847ms 中央値**含まれることが分かった。

`/api/auth/verify` は `req.access` を返すだけの **純粋な read（cookie 副作用なし）**で、
client は**結果を破棄**（`_ensureAuthenticated` は自前で例外を握りつぶす）。WS upgrade
ハンドラがサーバ側で独自に認証するため、この pre-verify は接続の前提条件ではない。
つまり **毎切替で ~847ms を、値を捨てる HTTP 往復に await して浪費**していた。

## Scope

- `connect()` の `await this._ensureAuthenticated()` を **fire-and-forget**（`void`）にする。
  verify は従来どおり発火するが、WS connect の critical path をブロックしない。
- これは ADR の「案A: warm 接続プール」より前に来る**データ駆動の最小・最低リスクの第一手**。
  残る connect コスト（ws-open + サーバ tmux attach の `ready` ~1s）に対する pool/server-warm-attach
  は別 story（ADR で sequencing 済み）。
- out of scope: warm 接続プール、server 側 warm attach、snapshot prefetch。

### 変更しない既存分岐（out of scope, 挙動不変）

- `session.intendedState === 'archived'`: 従来どおり `switchSession` 冒頭で短絡。
- `session?.intendedState === 'broken'`: 従来どおり `_resumeSuspendedRuntimeIfNeeded` が `{ ok: false }`。

## Acceptance Criteria

- [x] A connect whose auth verify never resolves still reaches WS ready and resolves mode live, because the discarded best-effort auth verify is fire-and-forget and does not block the connect critical path.
- [x] A normal connect whose auth verify resolves still reaches WS ready and resolves mode live, so making auth verify non-blocking does not regress the happy path.

## Verification

- `tests/unit/terminal-transport-auth-nonblocking.test.js`: hanging auth verify -> connect still
  resolves mode:live within a 500ms wall-clock guard (pre-fix would block).
- `tests/e2e/story-session-switch-auth-nonblocking-xterm.spec.js`: real-browser equivalents.
- Existing transport suites (110) green.
- Performance: VibePro `before` baseline = 2350ms total (connect 1833). Expected after ≈ 1500ms
  (connect − ~847ms auth). `performance record --label after` + `compare` post-deploy.
