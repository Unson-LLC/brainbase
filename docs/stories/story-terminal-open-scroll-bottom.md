---
story_id: story-terminal-open-scroll-bottom
title: Open terminal at latest output
source_requirement:
  type: user_report
  description: Claude Code sessions can open with xterm scrolled to the oldest history, forcing the user to manually scroll to the latest output.
architecture_docs:
  - path: docs/brainbase-capabilities/capabilities/terminal.transport.yml
    status: referenced
    reason: This is a client-side xterm viewport policy inside the existing terminal transport capability.
  - path: docs/architecture/ADR-terminal-history-scrollback.md
    status: referenced
    reason: Full-history snapshots and xterm scrollback must remain consistent while changing the initial viewport position.
related_tasks:
  - task_source: VibePro
    task_ids: [story-terminal-open-scroll-bottom]
status: active
created_at: 2026-05-21
updated_at: 2026-05-21
---

# Open terminal at latest output

## Background

Brainbase keeps xterm scrollback so Claude Code and Codex history can be inspected after switching or reconnecting. Some Claude Code sessions have enough scrollback that the first snapshot after opening the terminal can leave the viewport at the oldest retained lines. The user then has to manually scroll to the newest output before continuing work.

## Scope

- Treat the first full snapshot after session open, session switch, reconnect, or explicit terminal reset as a "show latest output" operation.
- Keep normal snapshot updates from stealing the user's viewport when they have intentionally scrolled up.
- Preserve xterm scrollback contents and tmux snapshot contracts.
- Add unit coverage for both reset/open pinning and non-reset viewport preservation.

## Acceptance Criteria

- [ ] A reset/full snapshot applied during terminal open or reconnect ends with xterm pinned to the latest output.
- [ ] A normal snapshot applied while the user is scrolled up restores the previous distance from the bottom.
- [ ] The fix uses the existing serialized terminal write path and does not introduce direct `terminal.write()` calls.
- [ ] The behavior is covered by tests that reproduce a top-scrolled viewport before snapshot application.

## Out Of Scope

- Changing tmux history capture size.
- Changing Claude Code or Codex process startup.
- Replacing xterm scrollback with a custom scroll container.

## Verification

```bash
vibepro story diagnose . --id story-terminal-open-scroll-bottom --run-graphify
npm run test:run -- tests/unit/terminal-transport-client.test.js
npm run typecheck
BRAINBASE_E2E_PORT=31014 BRAINBASE_PORT=31014 PORT=31014 npx playwright test tests/e2e/story-terminal-open-scroll-bottom-xterm.spec.ts --project=chromium
```
