---
story_id: str.brainbase.sns-ledger-manual-refresh
title: SNS cockpit manual ledger refresh
status: active
horizon: M5
view: ops
period: 2026-05
architecture_docs:
  - docs/architecture/sns-ledger-manual-refresh-architecture.md
spec_docs:
  - docs/specs/sns-ledger-manual-refresh-spec.md
---

# Story: SNS cockpit manual ledger refresh

## Story ID

`str.brainbase.sns-ledger-manual-refresh`

## Background

SNS Growth Cockpit can stay open across a day or week boundary. Auto refresh reloads the currently selected date range, so an already-open tab can keep showing last week's calendar until a hard refresh recreates the view and recomputes `todayJst()`.

Related architecture: [SNS ledger manual refresh architecture](../architecture/sns-ledger-manual-refresh-architecture.md)

Related spec: [SNS ledger manual refresh spec](../specs/sns-ledger-manual-refresh-spec.md)

## User Story

As the SNS operator, I want a visible refresh control that updates the cockpit to the current week and reloads the Ledger without a browser hard refresh, so I can trust the calendar after `/ohayo` or after leaving the page open overnight.

## Acceptance Criteria

- AC-1: SNS Growth Cockpit shows a visible update button in the calendar toolbar.
- AC-2: Clicking the update button recomputes `today`, `startDate`, and `endDate` from the current JST date before fetching posts.
- AC-3: The update button reloads posts through the real SNS Posting Ledger API path used by the page.
- AC-4: The existing error retry path still reloads posts.
- AC-5: Manual refresh does not publish, approve, delete, or otherwise mutate posts.

