# Graphify Impact Review — session-switch perf instrumentation

PR: instrument `/terminal/ensure` timing to diagnose slow session activation.

- command: `vibepro graph . --run-graphify`
- artifact: `.vibepro/graphify/graph.json` (graph totals: nodes=5252 links=10365)
- impacted paths: `server/controllers/session/runtime-handlers.js: nodes=16 links=19`
- assessment: Logging-only change inside `ensureTerminalRuntime`. No nodes or
  call edges are added or removed; the 16 nodes / 19 links of this file keep the
  same shape. The timing logs sit on existing code paths, so the runtime / WS /
  UI graph is unaffected.
- targeted verification: `tests/unit/server-session-controller.test.js` +
  `tests/unit/terminal-runtime-api-surfaces.test.js` → 71/71 pass.
