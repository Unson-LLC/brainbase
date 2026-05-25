---
spec_id: SPEC-codex-appserver-repl-activity-bridge
story_id: story-codex-appserver-repl-activity-bridge
title: Codex App Server REPL activity bridge completion
source_architecture:
  - ADR-codex-appserver-repl-activity-bridge
source_files:
  - docs/stories/story-codex-appserver-repl-activity-bridge.md
  - docs/architecture/codex-appserver-repl-activity-bridge-architecture.md
  - docs/brainbase-capabilities/capabilities/codex.app-server.yml
  - scripts/codex-app-repl.mjs
  - scripts/lib/codex-app-server-activity-client.mjs
created_at: 2026-05-25
updated_at: 2026-05-25
---

# SPEC-codex-appserver-repl-activity-bridge: Codex App Server REPL activity bridge completion

## Objective

Make the user-facing Codex App Server REPL path use the structured App Server activity and session-state contract so active indicators start and complete correctly on the live Brainbase runtime.

## Requirements

- **REQ-1**: `turn/started` must report `status=working`, `lifecycle=turn_started`, `eventType=turn/started`, and the App Server turn id when available.
- **REQ-2**: `turn/completed` must report `status=done`, `lifecycle=turn_completed`, `eventType=turn/completed`, and the same active turn id when available.
- **REQ-3**: App Server thread id must be persisted to `session.codexAppServer.threadId` for the REPL session when known.
- **REQ-4**: Completion must clear `session.codexAppServer.activeTurnId`.
- **REQ-5**: Completion aliases such as `codex/event/task_complete`, user-input waits, failures, and interrupts must report a structured completion instead of legacy unscoped `done`.
- **REQ-6**: Missing `sessionId` must produce no activity or state mutation.
- **REQ-7**: The helper must not depend on browser globals or direct server internals.
- **REQ-8**: Terminal/xterm transport files must remain unchanged.
- **REQ-9**: Capability Map must mention the REPL helper as a verified code surface for App Server activity.
- **REQ-10**: Failed REPL HTTP writes to the activity or state APIs must emit a stderr warning at least once per endpoint/method.
- **REQ-11**: PR readiness must not claim port `31013` is live on this branch before merge; the live-runtime smoke is a post-merge release verification.

## Acceptance Mapping

| Acceptance Criterion | Verification |
|---|---|
| Start sends structured working activity | Unit test for `buildActivityReportPayload()` |
| Completion clears active turn | Unit test for completion payload and state patch |
| Thread metadata persists | Unit test for `buildCodexAppServerStatePatch()` |
| Missing ids are non-mutating | Unit test with missing `sessionId` |
| Claude Code unaffected | Scope check and protected-path diff |
| HTTP report failures are detectable | Contract test asserts response status handling and stderr warning path |
| 31013 live smoke | Post-merge manual smoke with `/api/version`, `/api/sessions/status`, `/api/state`, and browser row state |

## Verification Commands

```bash
npm run test:run -- tests/unit/codex-app-server-activity-client.test.js
npm run test:run -- tests/server/services/codex-app-server-activity-bridge.test.js tests/server/services/codex-app-server-session-state.test.js
npm run typecheck
git diff --name-only origin/develop..HEAD -- public/modules/core/terminal-transport-client.js scripts/codex-pty-shim.py
```
