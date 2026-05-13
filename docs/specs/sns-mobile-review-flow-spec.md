---
spec_id: SPEC-sns-mobile-review-flow
title: SNS Mobile Review Flow
status: draft
date: 2026-05-13
story_id: story-sns-mobile-review-flow
related_adrs:
  - ADR-012
  - ADR-013
related_specs:
  - SPEC-sns-growth-cockpit-ui-transition
implementation_files:
  - public/index.html
  - public/modules/app/plugin-registration-mixin.js
  - public/modules/ui/panel-layout-manager.js
  - public/modules/ui/views/sns-growth-cockpit-view.js
  - public/style.css
test_files:
  - tests/ui/views/sns-growth-cockpit-view.test.js
  - tests/ui/panel-layout-manager.test.js
---

# SPEC: SNS Mobile Review Flow

## Invariants

- **INV-1**: Mobile SNS Growth starts from today's decision inbox, not the weekly calendar grid.
  - 検証: `tests/ui/views/sns-growth-cockpit-view.test.js`
- **INV-2**: Desktop SNS Growth keeps the Ship Calendar and right detail panel.
  - 検証: `tests/ui/views/sns-growth-cockpit-view.test.js`
- **INV-3**: Mobile `SNS` entry opens the existing Brainbase SNS overlay through panel layout, without URL navigation.
  - 検証: `tests/ui/panel-layout-manager.test.js` and browser smoke
- **INV-4**: Brainbase chrome that competes with mobile SNS review is hidden while `sns-growth-mode-active` is active.
  - 検証: browser smoke at 390px viewport
- **INV-5**: SNS post detail remains available on mobile; only Brainbase's outer right drawer is suppressed.
  - 検証: browser smoke and CSS review

## Contracts

### Contract-1: Mobile SNS Entry

- **input**: tap on `#mobile-sns-growth-btn`
- **output**: `sns-growth-overlay` opens and `body.sns-growth-mode-active` is set
- **preconditions**: Brainbase mobile bottom navigation is visible
- **postconditions**:
  - URL remains Brainbase home
  - SNS bottom nav entry is active
  - terminal/session context is preserved
- **error cases**:
  - if panel manager is unavailable, button is inert and does not navigate away

### Contract-2: Mobile Decision Inbox

- **input**: fixture or ledger post records for today
- **output**:
  - mobile-only `sns-mobile-review-flow`
  - status count chips
  - list of today decision cards
  - each card includes time, status, source type, rationale, and check indicators
- **preconditions**: SNS Growth view is mounted
- **postconditions**:
  - selected post id is reused by desktop calendar and mobile decision cards
  - selecting a card updates detail panel content
- **error cases**:
  - zero posts renders the same container with empty-state copy in a later slice

### Contract-3: Mobile Detail Review

- **input**: selected post
- **output**:
  - post body
  - source URL
  - Persona Brain
  - Graph Check
  - Quality Gate
  - Reader affect
  - action controls
- **preconditions**: a selected post exists
- **postconditions**:
  - the detail surface is visible after the mobile inbox, not removed
- **error cases**:
  - missing source URL falls back to existing fixture fallback

## Scenarios

### S-1: Mobile SNS Entry Opens Focused Workspace

- **given**: viewport width is 390px and Brainbase Home is open
- **when**: the operator taps `SNS` in mobile bottom navigation
- **then**: SNS Growth overlay opens, URL does not change, terminal chrome is hidden, and mobile bottom nav remains available
- **検証**: browser smoke

### S-2: Mobile Inbox Selects Post Detail

- **given**: SNS Growth view is mounted
- **when**: the operator taps a mobile decision card
- **then**: the selected card is active and detail content changes to that post
- **検証**: `tests/ui/views/sns-growth-cockpit-view.test.js`

### S-3: Desktop Calendar Is Preserved

- **given**: desktop viewport
- **when**: SNS Growth view is mounted
- **then**: weekly calendar and right detail panel are still rendered
- **検証**: `tests/ui/views/sns-growth-cockpit-view.test.js`

## Anti-patterns

- **AP-1**: Do not make the mobile first screen a 7-column weekly calendar.
  - **理由**: phone usage is a quick judgment queue, not campaign planning.
  - **検証**: CSS and browser smoke
- **AP-2**: Do not hide the SNS post detail panel to satisfy "hide right panel".
  - **理由**: the unwanted panel is Brainbase's outer right drawer; SNS detail is required for review.
  - **検証**: browser smoke checks `.sns-growth-detail` is visible
- **AP-3**: Do not navigate to `/sns-growth.html` from mobile Brainbase.
  - **理由**: mobile must preserve Brainbase context and return path.
  - **検証**: browser smoke checks URL unchanged

## Verification

| Clause | Test | Status |
|---|---|---|
| INV-1 | tests/ui/views/sns-growth-cockpit-view.test.js | pass |
| INV-2 | tests/ui/views/sns-growth-cockpit-view.test.js | pass |
| INV-3 | tests/ui/panel-layout-manager.test.js + browser smoke | pass |
| INV-4 | browser smoke 390px | pass |
| INV-5 | browser smoke 390px | pass |
| S-2 | tests/ui/views/sns-growth-cockpit-view.test.js | pass |
| AP-2 | browser smoke 390px | pass |
