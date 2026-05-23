---
story_id: story-xterm-focus-report-sanitize
title: Xterm focus report sanitization
source_requirement:
  type: user_report
  description: Terminal focus changes sometimes insert "[I" into the active Codex or Claude Code input.
architecture_docs:
  - path: docs/brainbase-capabilities/capabilities/terminal.transport.yml
    status: referenced
    reason: Terminal transport owns xterm input, local echo, WebSocket input messages, and server-side terminal IO.
related_tasks:
  - task_source: VibePro
    task_ids: [story-xterm-focus-report-sanitize]
status: active
created_at: 2026-05-20
updated_at: 2026-05-20
---

# Xterm Focus Report Sanitization

## Background

xterm.js can emit focus-in and focus-out reports as `ESC[I` and `ESC[O`. When the ESC byte is stripped or interpreted elsewhere, the remaining bare `[I` or `[O` can appear as user text in the prompt. Brainbase must treat these sequences as terminal control responses, not user input.

## Scope

- Strip full focus reports (`ESC[I`, `ESC[O`) before local echo, batching, or WebSocket send.
- Strip bare focus report fragments (`[I`, `[O`) before local echo, batching, or WebSocket send.
- Keep server-side terminal transport and terminal IO as a second sanitization layer.
- Preserve normal text ordering around stripped fragments.
- Preserve existing terminal transport lifecycle behavior: jsdom-only fallbacks remain test-environment guards, hidden disconnect sessions continue to reconnect without losing session context, and pending startup shells continue to reject terminal IO until ready.

## Acceptance Criteria

- [x] Focus report bytes are not echoed into the xterm surface.
- [x] Focus report bytes are not sent to tmux/terminal input.
- [x] Text before and after a focus report fragment is joined and sent in order.
- [x] The server drops focus-only input messages and strips focus fragments from mixed text.

## Verification

```bash
npm run test:run -- tests/unit/terminal-transport-client.test.js tests/server/services/terminal-transport-service.test.js tests/unit/server-session-manager.test.js
npm run test:e2e -- tests/e2e/story-xterm-focus-report-sanitize.spec.js
node --check public/modules/core/terminal-transport-client.js
node --check server/services/terminal-transport-service.js
node --check server/services/session-runtime/terminal-io-methods.js
node --check tests/e2e/story-xterm-focus-report-sanitize.spec.js
vibepro pr prepare . --base origin/develop --story-id story-xterm-focus-report-sanitize
```
