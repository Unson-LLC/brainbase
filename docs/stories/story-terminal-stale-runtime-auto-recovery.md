---
story_id: story-terminal-stale-runtime-auto-recovery
title: Terminal stale runtime auto recovery
source_requirement:
  type: user_report
  description: After Brainbase restart, active sessions can keep tmux/Codex alive while UI terminal transport remains frozen because persisted ttyd pid/port is stale.
architecture_docs:
  - path: docs/architecture/terminal-runtime-architecture.md
    status: referenced
    reason: Runtime health must distinguish tmux/Codex liveness from browser terminal transport readiness.
related_tasks:
  - task_source: VibePro
    task_ids: [story-terminal-stale-runtime-auto-recovery]
status: active
created_at: 2026-05-23
updated_at: 2026-05-23
---

# Terminal stale runtime auto recovery

## Background

Brainbase can restart while existing tmux sessions survive. In that state,
`state.json` may still contain a `ttydProcess` pid/port from the previous server
generation, but the pid is gone and the port is no longer listening. The session
row may look connected or recover only partially, while the browser terminal
stays frozen until a manual terminal/runtime restart is performed.

## Scope

- Detect active sessions where tmux exists but the expected ttyd transport is
  missing.
- Classify that state as degraded instead of snapshot-only/healthy.
- Let the runtime reconciler reconnect ttyd with `startTtyd({ forceTtyd: true })`
  so the periodic watchdog can repair the terminal transport even when tmux
  already exists.
- Preserve existing tmux/Codex work when only ttyd is stale.
- On first browser open after restart, refresh stale ttyd classification before
  choosing the recovery path, even if the runtime registry is still cold.
- Keep existing shell/ttyd binary discovery behavior unchanged, including
  platform-specific `USERPROFILE` fallback paths.
- Leave startup-pending/failed shell sessions on the existing startup flow; stale
  ttyd recovery must not turn an unfinished session setup into an interactive
  terminal.

## Acceptance Criteria

- [ ] Active tmux + missing ttyd + persisted `ttydProcess` is reported as a critical runtime issue.
- [ ] `recover: true` reconnects ttyd for the affected session without killing tmux.
- [ ] Sessions without persisted ttyd remain snapshot-only when no browser input probe is fresh.
- [ ] The watchdog can surface recovery actions in logs instead of silently treating the state as healthy.
- [ ] Failed ttyd reconnects keep the previous persisted `ttydProcess` marker so later health checks still detect the stale runtime.
- [ ] Boot restore does not trust a persisted pid unless an observed ttyd process is actually attached to that session.
- [ ] Startup-pending/failed shell sessions remain excluded from terminal recovery, runtime snapshot, and legacy repair paths.
- [ ] Failed stale ttyd recovery does not restore a misleading dead iframe in the browser.
- [ ] Live browser smoke on a non-canonical test port exercises state, runtime, snapshot, ensure/probe, and terminal health endpoints without failed requests.

## Verification

```bash
vibepro story diagnose . --id story-terminal-stale-runtime-auto-recovery --run-graphify
npm test -- tests/unit/terminal-runtime-reconciler.test.js tests/unit/session-runtime-maintenance-methods.test.js tests/unit/terminal-runtime-api-surfaces.test.js tests/server/session-manager.test.js tests/unit/server-session-controller.test.js
BRAINBASE_E2E_REUSE_SERVER=true npx playwright test tests/e2e/story-terminal-stale-runtime-auto-recovery-contract.spec.ts --project=chromium
BRAINBASE_E2E_PORT=32123 BRAINBASE_E2E_VAR_DIR=/tmp/brainbase-vibepro-live-smoke-var BRAINBASE_TEST_MODE=true BRAINBASE_ALLOW_DIRECT_SERVER=1 npm run test:server
npm run typecheck
vibepro verify record . --id story-terminal-stale-runtime-auto-recovery --kind unit --status pass --command "npm test -- tests/unit/terminal-runtime-reconciler.test.js tests/unit/session-runtime-maintenance-methods.test.js tests/unit/terminal-runtime-api-surfaces.test.js tests/server/session-manager.test.js tests/unit/server-session-controller.test.js" --summary "TerminalRuntimeReconciler reconnects stale ttyd through the lifecycle helper, preserves tmux and stale markers on failed reconnects, watchdog logs recovery accurately, legacy repair skips non-persisted ttyd, and API surfaces expose recovery state."
vibepro pr prepare . --base origin/develop --story-id story-terminal-stale-runtime-auto-recovery
```
