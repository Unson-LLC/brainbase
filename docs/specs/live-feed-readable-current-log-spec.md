---
spec_id: SPEC-live-feed-readable-current-log
story_id: story-live-feed-readable-current-log
title: Live Feed Readable Current Log
status: active
date: 2026-05-25
implementation_files:
  - public/modules/ui/views/live-feed-view.js
  - public/style.css
test_files:
  - tests/ui/views/live-feed-view.test.js
  - tests/e2e/story-live-feed-readable-current-log-contract.spec.ts
---

# Live Feed Readable Current Log

## Invariants

- **INV-1**: Scope controls use stable single-line labels for `このセッション` and `全体`.
- **INV-2**: Current-session scope omits repeated session id metadata from rows.
- **INV-3**: All-session scope includes session identity metadata per row.
- **INV-4**: Duplicate status/source labels are collapsed.
- **INV-5**: Disabled row action controls are not rendered.

## Contracts

### Contract-1: Current-session row

- input: current scope, `currentSessionId = session-alpha`, prompt entry with raw prompt provenance.
- output: row shows label/status/time/text, does not show `session-alpha`, and does not duplicate `ユーザー入力` in metadata.

### Contract-2: All-session row

- input: all scope with Alpha and Beta entries.
- output: rows remain chronological and include `session-alpha` / `session-beta` metadata.

### Contract-3: Narrow drawer controls

- input: 430px Live Feed panel.
- output: scope labels remain horizontal and each scope button has stable dimensions.
