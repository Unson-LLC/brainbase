---
architecture_id: live-feed-activity-timeline-architecture
title: Live Feed Activity Timeline Architecture
story_ref: story-live-feed-activity-timeline
status: active
created_at: 2026-05-24
updated_at: 2026-05-24
---

# Live Feed Activity Timeline Architecture

## Purpose

Live Feed is a right-drawer observation surface for current AI session activity. It lets a user monitor multiple sessions without opening each terminal.

This architecture is reverse-engineered from the current implementation and VibePro dogfood evidence.

## Current Runtime Shape

```text
server hook/activity state
  -> /api/sessions/status polling
  -> sessionUi.byId[sessionId].hookStatus
  -> deriveSessionUiState(sessionId)
  -> LiveFeedService._refreshEntries()
  -> LiveFeedView._render()
```

## Components

- `public/modules/domain/live-feed/live-feed-service.js`
  - Owns the in-memory feed entry list.
  - Subscribes to `appStore`.
  - Reads `state.sessions` and derived `sessionUi` state.
  - Converts each non-archived session into a single current feed entry.
- `public/modules/ui/views/live-feed-view.js`
  - Renders the right-drawer Live Feed tab.
  - Provides segmented filters: all, task, wiki, session, system.
  - Groups visible entries as NOW, RECENT, and EARLIER.
- `public/modules/session-ui-state.js`
  - Merges hook status, recent files, summary, transport, and attention into derived UI state.
- `public/modules/core/session-activity-state.js`
  - Maps hook status to idle, waiting, working, thinking, and done-unread.

## Ordering Contract

Live Feed is a stable activity timeline, not a latest-heartbeat ticker.

- Each session has at most one entry.
- `content fingerprint` detects whether row content needs to update.
- `movement key` detects whether a row is allowed to move.
- Content-only changes update the existing row in place.
- Meaningful activity transitions may move a row to the top.
- Equal-priority unchanged rows preserve their relative order.

## Current Rendering Contract

`LiveFeedView` re-renders the container after service notification.

- A service notification causes `_render()`.
- `_render()` replaces `container.innerHTML`.
- Filters and icons are rebound after each render.
- Multiple changed sessions from one store update are batched into one notification.

This is simple, but it makes high-frequency status polling visibly flicker.

## Known UX Problem

The pre-fix user experience could feel like "fast blinking" or "unexplained shuffling" because two independent behaviors combined:

- Order changes are driven by any fingerprint change, not only meaningful user-visible state transitions.
- Rendering replaces the whole Live Feed DOM, not only the changed row.

The result is that rows can jump even when the user only expected a label, timestamp, assistant snippet, or status tone to update in place.

## Implemented Stability Policy

Live Feed separates two concepts:

- `movementKey`: when a row is allowed to move.
- `fingerprint`: when row content should update in place.

Stable ordering policy:

- Move a row only when a meaningful activity transition occurs: idle -> working, working -> waiting, working -> done, connected -> blocked, or a new task/session appears.
- Do not move a row only because assistant snippet text, lastActivityAt heartbeat, recent file, or footer timestamp changed.
- Preserve relative order for equal-priority rows.
- Batch app-store updates into one render frame.
- Refresh stale-working state through an explicit timer instead of waiting for unrelated store updates.

## Non-Goals

- Live Feed must not become the source of truth for session state.
- Live Feed must not add a new realtime transport by itself.
- Live Feed must not show full terminal logs or full conversation transcripts.
- Live Feed row actions should remain non-mutating until a separate interaction contract is defined.

## Evidence

- `public/modules/domain/live-feed/live-feed-service.js`
- `public/modules/ui/views/live-feed-view.js`
- `public/modules/session-ui-state.js`
- `public/modules/core/session-activity-state.js`
- `tests/unit/live-feed-service.test.js`
- `tests/ui/views/live-feed-view.test.js`
- `docs/internal/vibepro-dogfood/runs/vibepro-brainbase-20260507-101513-command-center-redesign/component-style-check.json`
