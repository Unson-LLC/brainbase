---
story_id: story-live-feed-activity-timeline
title: Live Feed Activity Timeline
source_requirement:
  type: reverse_engineered
  description: Command Center redesign and existing Live Feed implementation imply a session-crossing activity timeline for monitoring current AI work.
architecture_docs:
  - path: docs/architecture/live-feed-activity-timeline-architecture.md
    status: reverse_engineered
    reason: Recovered architecture for Live Feed ordering, rendering, and update contracts.
  - path: docs/internal/vibepro-dogfood/runs/vibepro-brainbase-20260507-101513-command-center-redesign/development-run.json
    status: referenced
    reason: Original VibePro dogfood run records Command Center redesign acceptance criteria and verification evidence.
  - path: docs/internal/vibepro-dogfood/runs/vibepro-brainbase-20260507-101513-command-center-redesign/component-style-check.json
    status: referenced
    reason: Component-style gate includes the Live Feed tab contract.
  - path: docs/design/brainbase-wiki-livefeed-component-reference-2026-05-07.png
    status: referenced
    reason: Visual reference for Wiki and Live Feed drawer components.
related_tasks:
  - task_source: VibePro
    task_ids: [vibepro-dogfood/ui-design/20260507-command-center-redesign]
related_specs:
  - docs/specs/story-live-feed-activity-timeline-spec.md
status: active
created_at: 2026-05-24
updated_at: 2026-05-24
---

# Live Feed Activity Timeline

## Background

Brainbase can run multiple AI sessions in parallel. Session rows and the terminal remain the primary work surfaces, but they do not give a compact cross-session answer to "which session is working, waiting for input, done, paused, or blocked right now?"

The Command Center redesign introduced a Live Feed tab in the right drawer. Its implementation and VibePro component evidence show a timeline-style monitoring surface backed by session UI state, hook status, and lightweight live activity metadata.

## User Story

As a Brainbase user monitoring multiple AI sessions, I want a Live Feed timeline that shows current session activity across the workspace, so I can decide where to act next without opening each terminal one by one.

## Scope

- Render a right-drawer Live Feed tab as a timeline stream with a LIVE status header, segmented filters, row actions, rail dots, and footer status.
- Keep unimplemented Live Feed row and header controls visually disabled until their interaction contracts are defined.
- Build feed entries from derived session UI state, hook status, recent file context, task brief, and assistant snippets.
- Show session activity states as human-readable tones: idle, waiting for input, working/thinking, done, paused, blocked, and archived.
- Group the newest entries into NOW, RECENT, and EARLIER sections.
- Filter entries by all, task, wiki, session, and system categories.
- Keep the feed as an observation surface; it must not become the source of truth for session state.

## Acceptance Criteria

- [ ] The Live Feed tab displays LIVE status, segmented filters, controls, timeline rows, row actions, and footer status.
- [ ] Session state changes produce or update feed entries without opening the session terminal.
- [ ] Waiting, working/thinking, done, paused, blocked, and idle states render with distinct labels, icons, and tones.
- [ ] A working session with no update for at least three minutes is shown as blocked with a "minutes without update" label.
- [ ] Archived sessions are excluded from the feed.
- [ ] Feed entries include timestamp, session label, session id, status text, task brief when available, and assistant snippet when available.
- [ ] The all, task, wiki, session, and system filters update counts and visible rows.
- [ ] Visual QA and E2E evidence verify the production-mounted Live Feed tab remains readable and stable.
- [ ] Heartbeat, assistant snippet, recent file, and timestamp-only updates do not reorder existing rows.
- [ ] Meaningful activity transitions can reorder rows: new entry, task switch, idle-to-working, working-to-waiting, working-to-done, paused/resumed, archived removal, and working-to-blocked.

## Out Of Scope

- Adding a new WebSocket or Server-Sent Events transport for Live Feed.
- Storing session state or conversation history inside Live Feed.
- Showing full terminal logs or full conversation transcripts in timeline rows.
- Enabling terminal/session side effects from the feed row actions before a separate interaction contract is defined.
- Redesigning the overall Command Center layout beyond the Live Feed component.

## Existing Evidence

- `public/modules/domain/live-feed/live-feed-service.js` derives feed entries from app store session state and `deriveSessionUiState`.
- `public/modules/ui/views/live-feed-view.js` renders filters, NOW/RECENT/EARLIER groups, timeline rows, and footer status.
- `docs/internal/vibepro-dogfood/runs/vibepro-brainbase-20260507-101513-command-center-redesign/component-style-check.json` contains `live_feed_tab_matches_generated_component`.
- `docs/session-archives/2026/04/pw-terminal-refactor.md` preserves an older `Live Feed改善` session archive, but not a full Story contract.

## Verification

```bash
npm run typecheck
npm run test:run -- tests/unit/live-feed-service.test.js tests/ui/views/live-feed-view.test.js
BRAINBASE_E2E_PORT=31991 npm run test:e2e -- tests/e2e/story-live-feed-activity-timeline-stability.spec.ts
vibepro story diagnose . --id story-live-feed-activity-timeline --run-graphify
```

---

**Guardrail**: This story is reverse-engineered from implementation and VibePro evidence. It should be treated as a recovered product contract, not proof that every acceptance criterion is already complete.
