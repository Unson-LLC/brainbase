# ADR (draft): Warm session-switch latency — avoid per-switch transport teardown

status: proposed / exploration
story: story-session-switch-warm

## Context

Warm session switch (runtime already up) takes a median ~2.35s. The user-perceived cost
is dominated by the terminal transport, not rendering. This ADR draft is the output of the
VibePro **Graphify impact + clean phase baseline** step — design choice is deferred until the
data and blast radius are on the table.

## Phase baseline (browser_e2e, 31013, isolated warm re-switch, n=5)

| phase | median ms | share |
|---|---|---|
| total (`_beginTerminalSwitch`→`_finishTerminalSwitch` ready_live) | 2350 | 100% |
| **connect** (`connect()`: WS open + `ready`/tmux-attach, from `_lastConnectMetric`) | **1833** | **78%** |
| non-connect (snapshot fetch + ensure-runtime + render) | ~517 | 22% |

Fastest warm sample: total 1275ms / connect 417ms — high variance, but connect always
dominates. **The bottleneck is the per-switch WS connect + server-side tmux attach, not the
client render.** Any optimization that does not remove the per-switch connect is chasing the
22%.

## Graphify blast radius (why this is ADR-necessary, not an internal tweak)

`terminal-transport-client.js` is high-coupling:
- **depended-by (25):** app.js, di-container, http-client, message-queue, terminal-interaction-service,
  xterm-loader, state, mobile-input/clipboard controllers, session-context-bar-view,
  server/mesh/mesh-service, **server/services/terminal-transport-service** (WS backend), worktree-service.
- **depends-on:** terminal-display-mixin, terminal-input-ux-mixin, **terminal-reconnect-manager**,
  auth-manager (ownership), session-data-cache, codex-app-server-display-mixin, relay/server.js.

Keeping connections warm therefore touches: the **single-surface invariant** (`_terminalSurface`),
the **ownership/takeover model** (one owner per session), **reconnect**, the **WS server**, and
**mobile**. This is the highest-coupling subsystem in the terminal stack.

## Options

- **A. Client-side warm connection pool (LRU, K≈2).** Don't `_closeWs()` on switch; keep the
  current + previous session's transport alive, toggle the visible surface. Attacks the 78%
  directly for back-and-forth switching. Risk: surface invariant across N hidden xterm surfaces
  (duplication-bug class), ownership (only the visible surface should own / send input), resource
  bound (NEVER all 388 — K small).
- **B. Surface-only swap + prefetch-next.** Keep one connection, pre-warm the likely-next. Smaller
  blast radius, narrower win.
- **C. Server-side warm attach / instant snapshot.** The `ready` handshake is slow because the
  server attaches tmux + builds a snapshot per connect. Pre-warm/cache server-side. Moves cost to
  backend (terminal-transport-service); independent of client.

The connect-dominates data points at **A or C** (both remove the per-switch attach). A pilot of
**A with K=2 behind a flag**, measured before/after with this VibePro metric, is the cheapest way
to learn whether the win is real before generalizing.

## Mandatory gate (non-negotiable)

The single-surface invariant deterministic harness (switch-hammer × visible-surface-count,
violation rate before/after; prior fix 6.9%→0.2%) MUST be a Spec acceptance criterion. A warm
pool that reintroduces 2-visible-surface states would trade latency for the exact
duplication/blank bug class this codebase already fought.

## Decision

Deferred. Next VibePro steps: ADR with chosen option + `vibepro spec write` (invariants incl.
the surface-invariant harness) → flagged K=2 pilot → `performance record --label after` →
`performance compare`. Do not generalize the pool until before/after proves the win and the
invariant harness stays green.
