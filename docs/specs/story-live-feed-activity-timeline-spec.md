---
spec_id: story-live-feed-activity-timeline-spec
title: Live Feed Activity Timeline Specification
story_ref: story-live-feed-activity-timeline
source_story: docs/stories/story-live-feed-activity-timeline.md
source_architecture: docs/architecture/live-feed-activity-timeline-architecture.md
status: active
created_at: 2026-05-24
updated_at: 2026-05-24
---

# Live Feed Activity Timeline Specification

## Scope

- `public/modules/domain/live-feed/live-feed-service.js`
- `public/modules/ui/views/live-feed-view.js`
- `public/modules/session-ui-state.js`
- `public/modules/core/session-activity-state.js`
- `tests/unit/live-feed-service.test.js`
- `tests/ui/views/live-feed-view.test.js`
- `tests/e2e/story-live-feed-activity-timeline-stability.spec.ts`

## Current Invariants

- INV-1: Live Feed derives entries from app store session state and derived session UI state.
- INV-2: Archived sessions are excluded.
- INV-3: Each session appears at most once in the feed.
- INV-4: A fingerprint change updates that session's row content.
- INV-5: A movement-key change is required before an existing row can move.
- INV-6: A changed entry uses the greatest available timestamp from task brief, assistant snippet, live activity, last activity, last working, and last done timestamps.
- INV-7: Working entries older than three minutes are rendered as blocked by label and tone.
- INV-8: Live Feed View renders filters, NOW/RECENT/EARLIER groups, row actions, rail dots, and footer status.
- INV-9: Filtering changes visible rows and count badges without mutating feed source state.

## Stability Invariants

- D-INV-1: Content updates that do not represent a meaningful activity transition update the row in place.
- D-INV-2: Row movement is limited to meaningful transitions: new entry, task switch, idle-to-working, working-to-waiting, working-to-done, working-to-blocked, resumed, paused, archived removal.
- D-INV-3: Heartbeat-like timestamp updates must not reorder rows by themselves.
- D-INV-4: Multiple changed sessions from one app-store update produce one batched view update.
- D-INV-5: Stale-working reclassification uses an explicit timer and does not depend on unrelated store updates.
- D-INV-6: Equal-priority rows preserve stable relative order unless a meaningful transition changes the order key.

## Current Scenarios

- S-1: Given two active sessions, when Live Feed starts, it creates one entry for each non-archived session.
- S-2: Given a session has a meaningful activity transition, when the store updates, the session's entry may move to the top.
- S-3: Given the store changes unrelated UI state, when no session fingerprint changes, duplicate entries are not added.
- S-4: Given a session has no live assistant snippet but has `lastAssistantSnippet`, the entry displays the persisted Japanese assistant snippet.
- S-5: Given the user selects the system filter, only system-classified rows remain visible.

- S-6: Given a session receives a heartbeat-only `lastActivityAt` update, when Live Feed refreshes, the row content may update but its relative order does not change.
- S-7: Given a session's assistant snippet changes while it is already visible, when Live Feed refreshes, the row text updates in place.
- S-8: Given several sessions change in one store update, when Live Feed refreshes, the view is notified once.
- S-9: Given a working session has no update for three minutes, when the stale timer fires, the row becomes blocked without waiting for unrelated store activity.
- S-10: Given several sessions have the same movement timestamp, when Live Feed refreshes, their existing session relative order is preserved.

## Future Scenarios

- DS-3: Given an idle session starts working, when Live Feed refreshes, that row may move into the newest active group.
- DS-4: Given a working session becomes waiting or done, when Live Feed refreshes, the row may move because the user needs to act or observe completion.

## Anti-Patterns

- AP-1: Treating every timestamp change as a reason to move a row.
- AP-2: Replacing the entire Live Feed DOM for every single row update.
- AP-3: Using Live Feed as a state source instead of a projection.
- AP-4: Adding new realtime infrastructure before stabilizing the derived state and ordering contract.
- AP-5: Leaving enabled clickable-looking row actions without a visible interaction contract.
- AP-6: Leaving enabled Live Feed control buttons without implemented pause, refresh, or filter-panel behavior.

## Verification

- Unit: `npm run test:run -- tests/unit/live-feed-service.test.js`
- View: `npm run test:run -- tests/ui/views/live-feed-view.test.js`
- E2E: `BRAINBASE_E2E_PORT=31991 npm run test:e2e -- tests/e2e/story-live-feed-activity-timeline-stability.spec.ts`
- Typecheck: `npm run typecheck`
- VibePro: `vibepro story diagnose . --id story-live-feed-activity-timeline --run-graphify`

## Regression And Surface Coverage

- Input paths: app-store session state, `/api/sessions/status` hook status polling, derived `sessionUi` state, session summaries, recent file context, and Live Feed filter clicks.
- Output surfaces: desktop right-drawer Live Feed, mobile resized Live Feed panel, row/header disabled affordances, filter count/footer text, Story/Architecture/Spec docs, VibePro verification records, and PR review evidence.
- Non-impacted surfaces: no server API contract, database schema, migration, authentication policy, terminal transport, PTY, snapshot, xterm, ttyd, or deployment configuration is changed.
- Runtime guard: the production-mounted E2E watches console errors, page errors, failed requests, and non-OK responses; local auth verification, state, and session-status fixtures are GET-only so unexpected write methods fail as runtime issues instead of being silently fulfilled.
- Visual guard: the production-mounted E2E pins `/api/sessions/status` to the fixture during screenshot capture, asserts mobile row order matches the desktop Live Feed output surface, and keeps Live Feed footer text clear of fixed bottom controls so desktop multi-row, system filter, and mobile visual evidence match the asserted Live Feed state.

## Open Questions

- Should Live Feed primarily rank by "needs user action" or by "latest meaningful activity"?
- Should done entries remain high until read, or decay below active/waiting entries?
- Should disabled row actions later navigate to the session, copy row text, or be removed until a separate action story is defined?
