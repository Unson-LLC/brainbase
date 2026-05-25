---
architecture_id: ADR-live-feed-readable-current-log
story_id: story-live-feed-readable-current-log
title: Live Feed current-session log readability
status: accepted
date: 2026-05-25
---

# Live Feed current-session log readability

## Decision

`LiveFeedView` owns viewer-local presentation choices for current/all scope. The service continues to return chronological history entries; the view decides which metadata is useful for the active scope.

## Design

- Add a scope class to the Live Feed container so CSS can tune current/all layouts without duplicating rendering paths.
- In current scope, omit row session id because it is already implied by the selected scope.
- In all scope, keep session id metadata so cross-session rows remain distinguishable.
- If `statusText` and source label normalize to the same label, render only the main status chip.
- Do not render disabled action buttons. Non-functional controls should not take primary row width.
- Use CSS grid/flex constraints so scope buttons retain stable horizontal labels in the narrow drawer.

## Boundaries

- `LiveFeedService` remains the owner of history projection and chronological ordering.
- `LiveFeedView` remains the owner of scope display and row metadata.
- `public/style.css` owns command-center theme spacing and responsive behavior.
