# Graphify Impact Review — session-switch cwd resolve fast path

PR: skip per-switch `tmux list-panes` workspace resolution when `session.path`
is already a valid directory (the measured cold-path cost of `/terminal/ensure`).

- command: `vibepro graph . --run-graphify`
- artifact: `.vibepro/graphify/graph.json` (graph totals: nodes=5420 links=10760)
- impacted paths:
  - `server/controllers/session/runtime-handlers.js: nodes=16 links=19`
  - `server/services/session-core/workspace-service-methods.js: nodes=2 links=1`
- assessment: Adds an opt-in `reuseExistingPath` short-circuit to
  `resolveSessionWorkspacePath` and uses it only from the terminal-ensure hot
  path. No nodes or call edges are added/removed; the graph shape of both files
  is unchanged. All existing callers keep the tmux-preferring behavior (reuse is
  opt-in), so the runtime/WS/UI graph is unaffected.
- measured evidence (from PR #932 instrumentation): cold-path `resolveCwdMs`
  ranged 29ms..1497ms across real session switches; this change removes that
  per-switch subprocess when the persisted path is valid.
- targeted verification:
  - new `tests/unit/workspace-resolve-reuse-existing.test.js` (3/3): skips tmux
    when path valid; falls back when stale; default callers unchanged.
  - `tests/unit/server-session-controller.test.js`,
    `tests/unit/terminal-runtime-api-surfaces.test.js` pass.
