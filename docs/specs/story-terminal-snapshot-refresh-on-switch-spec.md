---
spec_id: story-terminal-snapshot-refresh-on-switch-spec
title: Terminal snapshot refresh on session switch specification
story_ref: story-terminal-snapshot-refresh-on-switch
source_story: docs/user_stories/active/story-terminal-snapshot-refresh-on-switch.md
source_architecture: docs/brainbase-capabilities/capabilities/terminal.transport.yml
status: active
created_at: 2026-05-19
updated_at: 2026-05-19
---

# Terminal snapshot refresh on session switch specification

## Scope

- `public/modules/app/session-management-mixin.js`
- `public/modules/app/terminal-input-ux-mixin.js`
- `tests/ui/integration/app-switch-session-runtime.test.js`
- `tests/e2e/story-terminal-snapshot-refresh-on-switch-session-switch.spec.ts`

## Invariants

- INV-1: Session switch keeps the cached terminal snapshot as the immediate placeholder when one exists.
- INV-2: Session switch always requests a fresh fast terminal snapshot after rendering a cached placeholder.
- INV-3: Cold-cache session switch uses the same `force: true, mode: 'fast'` snapshot capture path.
- INV-4: `force: true` snapshot loading never reuses an existing in-flight snapshot request.
- INV-5: The existing archived session guard is maintained; `session.intendedState === 'archived'` must remain a no-op for snapshot refresh and must not activate or restore the session.
- INV-6: Late snapshot responses must update the visible terminal snapshot only when the target session still matches `state.currentSessionId` / `appStore.getState().currentSessionId`.

## Contracts

- C-1: `_loadTerminalSnapshot(sessionId, { force: true, mode: 'fast' })` creates a new request key for the target session.
- C-2: A stale snapshot response returns the latest cache value without replacing the cache entry for a newer request key.
- C-3: This story does not change the tmux snapshot API response shape or terminal transport lifecycle contract.

## Scenarios

- S-1: Given a desktop xterm switch with a cached snapshot, when `switchSession` runs, then the cached snapshot is shown immediately and a fresh fast snapshot request is started.
- S-2: Given a desktop xterm switch without a cached snapshot, when `switchSession` runs, then a fresh fast snapshot request is started before xterm readiness.
- S-3: Given a mobile switch with a cached snapshot, when the fresh snapshot resolves and the target session is still selected, then the snapshot panel is replaced with the fresh content.
- S-4: Given an archived target session, when `switchSession` or snapshot preload logic sees `session.intendedState === 'archived'`, then it skips refresh work and preserves the existing archived behavior.
- S-5: Given the user switches away before a fresh snapshot response resolves, when the response handler runs, then it checks `state.currentSessionId` / `appStore.getState().currentSessionId` before updating the visible snapshot.

## Anti-patterns

- AP-1: Treating a cached snapshot as fresh terminal state.
- AP-2: Reusing an in-flight snapshot request when the caller requested `force: true`.
- AP-3: Restoring or activating archived sessions as a side effect of snapshot refresh.
- AP-4: Updating the visible terminal snapshot for a session that is no longer selected.

## Verification

- Integration: `npm run test:run -- tests/ui/integration/app-switch-session-runtime.test.js`
- Typecheck: `npm run typecheck`
- E2E: `PLAYWRIGHT_HTML_OPEN=never npx playwright test tests/e2e/story-terminal-snapshot-refresh-on-switch-session-switch.spec.ts --project=chromium`
