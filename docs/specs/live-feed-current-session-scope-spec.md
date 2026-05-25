---
spec_id: SPEC-live-feed-current-session-scope
title: Live Feed Current Session Scope
status: active
date: 2026-05-25
story_id: story-live-feed-current-session-scope
related_adrs:
  - ADR-live-feed-current-session-scope
implementation_files:
  - public/modules/ui/views/live-feed-view.js
  - public/style.css
test_files:
  - tests/ui/views/live-feed-view.test.js
  - tests/unit/live-feed-service.test.js
---

# Live Feed Current Session Scope

## Invariants

- **INV-1**: If `appStore.currentSessionId` is present, Live Feed defaults to current-session scope.
  - Verification: `tests/ui/views/live-feed-view.test.js`
- **INV-2**: Current-session scope calls `getHistoryEntries({ mode: 'session', sessionId: currentSessionId })` when history projection is available.
  - Verification: `tests/ui/views/live-feed-view.test.js`
- **INV-3**: All-session scope calls `getHistoryEntries({ mode: 'all' })` and renders the same chronological stream without session grouping.
  - Verification: `tests/ui/views/live-feed-view.test.js`
- **INV-4**: Store changes to `currentSessionId` trigger a Live Feed re-render.
  - Verification: `tests/ui/views/live-feed-view.test.js`
- **INV-5**: The primary header exposes scope controls, not category filters.
  - Verification: `tests/ui/views/live-feed-view.test.js`

## Contracts

### Contract-1: Current-session scope

- **input**: `currentSessionId = "session-alpha"` and activity history entries for multiple sessions.
- **output**: Only entries for `session-alpha` are rendered.
- **preconditions**: `LiveFeedService.getHistoryEntries` exists.
- **postconditions**: Footer shows `時系列 / 範囲: このセッション`.
- **error cases**: If no current session exists, current-session scope is disabled and the view falls back to all-session scope labeling.

### Contract-2: All-session scope

- **input**: User clicks the `全体` scope button.
- **output**: All history entries are rendered in service-provided chronological order.
- **preconditions**: Entries include valid `timestamp` and `sessionId`.
- **postconditions**: Footer shows `時系列 / 範囲: 全体`.
- **error cases**: Empty history renders an empty state with guidance to switch scope.

### Contract-3: Readability layout

- **input**: A Live Feed entry with session id, timestamp, provenance, and prompt/activity text.
- **output**: The row gives primary width to text content and keeps timestamp in metadata rather than a wide left column.
- **preconditions**: Command-center theme CSS is active.
- **postconditions**: The visible row can show up to two lines of activity text.

## Scenarios

### S-1: Opening a session shows that session's history

- **given**: `currentSessionId` is `session-alpha`.
- **when**: Live Feed mounts.
- **then**: The view requests session-scoped history for `session-alpha` and renders only Alpha rows.

### S-2: User switches to the global activity log

- **given**: Live Feed is showing the current session.
- **when**: The user clicks `全体`.
- **then**: The view renders all history rows in chronological order.

### S-3: No current-session entries exist

- **given**: `currentSessionId` is set but all entries belong to other sessions.
- **when**: Live Feed renders.
- **then**: The empty state says `このセッションの更新はありません`.

## Anti-patterns

- **AP-1**: Treating Live Feed as another active-session list.
  - **reason**: The session list already handles active-session ordering.
- **AP-2**: Adding multiple visual modes for chronological display.
  - **reason**: The user wants one timeline with a scope filter, not separate "history mode" and "global mode."
- **AP-3**: Promoting generic categories over current/all scope.
  - **reason**: Categories hide the main workflow behind secondary filtering.

## Verification

| Clause | Test | Status |
|---|---|---|
| INV-1 | `tests/ui/views/live-feed-view.test.js` default render test | pass |
| INV-2 | `tests/ui/views/live-feed-view.test.js` current session history test | pass |
| INV-3 | `tests/ui/views/live-feed-view.test.js` all scope switch test | pass |
| INV-4 | `tests/ui/views/live-feed-view.test.js` store subscription assertion | pass |
| INV-5 | `tests/ui/views/live-feed-view.test.js` scope controls assertions | pass |
