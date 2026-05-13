---
story_id: story-sns-mobile-review-flow
title: SNS Mobile Review Flow
status: draft
date: 2026-05-13
related_specs:
  - SPEC-sns-mobile-review-flow
architecture_docs:
  - docs/architecture/ADR-012-sns-growth-cockpit-visual-slice.md
  - docs/architecture/ADR-013-sns-mobile-review-flow.md
related_stories:
  - story-sns-posting-cockpit
  - story-sns-persona-brain-gate
---

# Story: SNS Mobile Review Flow

## User Story

As さとけい checking brainbase from a phone,
I want SNS Growth to open as a mobile decision inbox for today's posts,
so that I can clear review decisions without operating the desktop calendar or opening X.

## Context

Desktop SNS Growth is an operations cockpit. It can show the week calendar, right detail panel, source evidence, research surfaces, and learning loop context at once.

Mobile should not be a squeezed desktop cockpit. When さとけい opens the phone, the likely job is not to redesign the week's campaign. The job is to clear the decisions blocking today's SNS operation.

The mobile surface therefore starts from "what needs my judgment today" and only then allows drilling into one post.

## Product Principle

Mobile SNS Growth is a judgment queue, not a calendar.

The first screen must answer:

- What posts require review now?
- Why is this post being suggested?
- Is there any reader-affect, Persona Brain, or Graph Check concern?
- Can I approve, request an edit, skip, or defer to PC?

## Scope

- Add a mobile entry point for SNS Growth from Brainbase mobile navigation.
- Open SNS Growth in a mobile-focused Brainbase workspace mode.
- Make the initial mobile surface a "today decision inbox".
- Keep the full Ship Calendar as a supporting surface, not the first mobile view.
- Keep the selected post detail and evidence visible after selecting a post.
- Preserve the desktop Ship Calendar behavior.

## Non-goals

- Do not implement durable SNS Posting Ledger persistence in this story.
- Do not add real X posting or X API reads.
- Do not make mobile the primary editing environment for campaign planning.
- Do not remove desktop calendar/detail behavior.

## Mobile Flow

1. さとけい taps `SNS` in the mobile bottom navigation.
2. Brainbase opens SNS Growth as a focused mobile surface.
3. The first screen shows today's review queue.
4. The queue shows status counts and post cards.
5. Tapping a post selects it and exposes the detail review surface.
6. The detail surface shows body, source, Persona Brain, Graph Check, Quality Gate, Reader affect, and action buttons.
7. さとけい can go back to Brainbase without losing the normal session context.

## Acceptance Criteria

- [ ] AC-1: Mobile bottom navigation exposes an `SNS` entry.
- [ ] AC-2: Tapping mobile `SNS` opens the in-shell SNS Growth overlay without changing URL.
- [ ] AC-3: While SNS Growth is active on mobile, Brainbase terminal chrome, tab bar, right drawer, and input dock do not compete with the SNS surface.
- [ ] AC-4: Mobile initial SNS surface shows a today decision inbox before the weekly calendar.
- [ ] AC-5: The decision inbox includes review / scheduled / posted counts.
- [ ] AC-6: Each mobile decision card shows time, status, source type, rationale, and safety/evidence checks.
- [ ] AC-7: Selecting a mobile decision card updates the post detail review surface.
- [ ] AC-8: The post detail review surface remains available on mobile and includes source / Persona Brain / Graph Check / Quality Gate / Reader affect.
- [ ] AC-9: Desktop SNS Growth keeps the week calendar with right detail panel.
- [ ] AC-10: Mobile must not present the weekly 7-column calendar as the primary first task.

## Task Candidates

| ID | Type | Title | Notes |
|----|------|-------|-------|
| TSK-sns-mobile-001 | FE | Mobile SNS navigation entry | Add bottom nav entry and route it through panel-layout-manager |
| TSK-sns-mobile-002 | FE | Today decision inbox | Add mobile-first inbox markup to SNS Growth view |
| TSK-sns-mobile-003 | FE | Mobile layout CSS | Focus overlay, hide competing Brainbase chrome, preserve bottom nav |
| TSK-sns-mobile-004 | QA | Mobile UI tests and smoke | Unit and browser verification for mobile entry/inbox/detail |

## Verification Plan

- Unit: SNS Growth view renders mobile decision inbox and selecting a card updates detail.
- UI: panel layout keeps URL unchanged and opens SNS overlay.
- Browser: 390px viewport shows mobile inbox first, Brainbase drawer hidden, SNS detail still available.
