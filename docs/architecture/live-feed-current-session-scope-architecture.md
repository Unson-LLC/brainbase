---
adr_id: ADR-live-feed-current-session-scope
title: Live Feed current session scope architecture
status: accepted
story:
  story_id: story-live-feed-current-session-scope
  story_path: docs/stories/story-live-feed-current-session-scope.md
created_at: 2026-05-25
updated_at: 2026-05-25
---

# ADR-live-feed-current-session-scope: Live Feed current session scope architecture

## Context

Live Feed has two responsibilities that must remain separate:

- projecting session activity history into chronological entries
- selecting which subset of that chronological stream the viewer is looking at

The existing service already exposes both current activity cards and `getHistoryEntries({ mode })`. The product gap is in the viewer control: the primary choice should be current session versus all sessions, not category filters or a separate session-chip mode.

## Decision

Keep `LiveFeedService` as the owner of activity-history projection. Make `LiveFeedView` the owner of viewer-local scope selection.

The view uses:

- `appStore.currentSessionId` as the selected-session input
- `LiveFeedService.getHistoryEntries({ mode: 'session', sessionId })` for current-session scope
- `LiveFeedService.getHistoryEntries({ mode: 'all' })` for all-session scope

Scope is a filter over one chronological activity stream. It does not create a second presentation mode, a grouped session list, or a new data source.

## Boundaries

| Layer | File | Responsibility |
|---|---|---|
| View | `public/modules/ui/views/live-feed-view.js` | Render Live Feed rows, current/all scope control, and subscribe to current-session changes. |
| Domain service | `public/modules/domain/live-feed/live-feed-service.js` | Project session state and activity history into chronological entries. |
| Store | `public/modules/core/store.js` | Provide `currentSessionId` and subscription notifications. |
| CSS | `public/style.css` | Keep Live Feed dense and readable in the command-center drawer. |

## Invariants

- **INV-1**: Live Feed scope selection must not mutate session state or activity history.
- **INV-2**: Current-session scope must follow `appStore.currentSessionId`.
- **INV-3**: All-session scope must preserve chronological ordering from `LiveFeedService`.
- **INV-4**: Category filtering must not be the primary Live Feed navigation for this workflow.
- **INV-5**: Timeline decoration must not crowd out prompt/activity text.

## Consequences

- Opening a session gives immediate context for that session's prior prompts and activity.
- The global activity log remains one click away.
- Session list ordering remains independent from Live Feed activity-history browsing.

## Alternatives Considered

- Keep category filters in the primary header: rejected because task/wiki/system categories do not match the user's current monitoring workflow.
- Use per-session chips for every session: rejected because it becomes another session list and scales poorly with many agents.
- Move scope into the left session list: rejected because Live Feed must remain usable from its own drawer/mobile surface.

## Verification Plan

- Unit view tests for default current-session scope, all-session switching, and current-session history projection.
- Existing service tests for history projection and heartbeat stability.
- VibePro Graphify / PR prepare evidence for affected UI paths.
