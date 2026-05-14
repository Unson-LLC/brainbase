---
story_id: story-sns-posting-cockpit
title: SNS Posting Cockpit MVP
status: active
date: 2026-05-12
related_specs:
  - SPEC-sns-growth-cockpit-ui-transition
  - SPEC-sns-growth-cockpit-wireframe-v0
  - SPEC-sns-mobile-review-flow
architecture_docs:
  - docs/architecture/ADR-011-sns-posting-ledger-boundary.md
  - docs/architecture/ADR-012-sns-growth-cockpit-visual-slice.md
  - docs/architecture/ADR-013-sns-mobile-review-flow.md
related_stories:
  - str.brainbase.personal-kg-sns-seed-mvp
  - story-sns-persona-brain-gate
  - story-sns-mobile-review-flow
---

# Story: SNS Posting Cockpit MVP

## User Story

As さとけい running SNS from brainbase,
I want an SNS growth cockpit where Today, Research, Review, Ship Calendar, and Learning are connected,
so that my SNS operation is visible, repeatable, and connected back to Personal KG learning.

## Context

The SNS line can now generate a daily review pack from weekly content design, Peer Circle signals, news signals, Persona Brain, Graph Check, and deterministic quality gates.

That solves draft creation, but it does not yet solve operations. Today the generated posts live as markdown and JSON artifacts under the SNS SSOT, and the operator still has to mentally track which posts need review, which are scheduled, which have been posted, and which reactions should become learning.

The next layer is not Graph itself. Graph remains the source of truth for people, philosophy, terms, decisions, and promoted learning. SNS posting needs a separate operational ledger on the same Lightsail PostgreSQL infrastructure, so daily posts can move through review, schedule, posting, metrics, and learning candidate states before anything is promoted back into Graph.

## Business Context

The goal is not "AI posts to X automatically." The goal is that brainbase becomes the operating cockpit for SNS: AI prepares reviewable posts, the operator can inspect and edit them, the system remembers schedule and state, and feedback can be returned into Personal KG.

This lets SNS operation become a closed loop:

1. `/ohayo` creates reviewable posts.
2. `Today` shows the next decision without turning the first screen into a calendar.
3. `Ship Calendar` shows this week's posting state with a right detail panel.
4. The operator reviews, edits, and schedules posts.
5. Posted URLs and metrics are recorded.
6. `/oyasumi` turns reaction and learning into promotion candidates.

## Scope

- Create a durable SNS posting ledger separate from Graph.
- Store generated review-pack posts from `/ohayo`.
- Show scheduled posts on a dedicated Ship Calendar view.
- Keep the first screen focused on one current review decision; calendar and research lists are supporting surfaces, not the primary workbench.
- Use the Brainbase operating loop in navigation: Today, Brain, Create, Run, Learn, System.
- Show each post's state: review needed, approved, scheduled, posted, skipped, or learning ready.
- Let the operator open one post, review the body, inspect source evidence, edit copy, and change state.
- Preserve source links for Peer Circle quotes, overseas/news posts, Personal KG memories, and quality-gate evidence.
- Make SNS Posting Cockpit accessible from brainbase navigation.

## Non-goals

- Do not make Graph the storage table for draft/review/schedule state.
- Do not automatically promote every post or metric into Graph.
- Do not require full X API auto-posting in the MVP.
- Do not replace the existing `/ohayo` and `/oyasumi` flows.
- Do not build a multi-account agency cockpit in this slice; start with さとけい's account.

## Acceptance Criteria

- [ ] AC-1: `/ohayo` can persist the daily review pack into the SNS posting ledger without duplicating the same generated post for the same date and slot.
- [ ] AC-2: The cockpit has a calendar or week view where each date shows planned posts and status badges at a glance.
- [ ] AC-3: Opening a post shows body, scheduled time, status, source URL, source type, Graph Check, Persona Brain, Quality Gate, and edit history.
- [ ] AC-4: The operator can edit post body and change status between review needed, approved, scheduled, posted, skipped, deleted, and learning ready.
- [ ] AC-5: A scheduled post has a scheduled datetime and remains visible in the calendar before posting.
- [ ] AC-6: A posted post can store the posted X URL and metrics snapshot.
- [ ] AC-7: Posts with Peer Circle or news sources preserve the source URL and make it easy to open the source while reviewing.
- [ ] AC-8: The cockpit is reachable from brainbase UI navigation without using a terminal command.
- [ ] AC-9: The ledger is stored in PostgreSQL on the existing Lightsail infrastructure, but in tables/schema separate from Graph SSOT.
- [ ] AC-10: `/oyasumi` or a later feedback flow can read posted records and create learning candidates, without directly mutating Graph from raw metrics.
- [ ] AC-11: The SNS Growth activity bar entry is additive: `ab-sns-growth-btn` is the only new branch, while existing `abSessionsBtn`, Portal/Terminal controls, and `targetSessionId` file-viewer close behavior remain unchanged.
- [ ] AC-12: A reviewed Ledger post can be dry-run checked without mutation, and can be publicly posted only after explicit confirmation; successful posting stores the X URL back into the Ledger.
- [ ] AC-13: If a posted X post is later deleted on X, the operator can mark the Ledger record as deleted without clearing the posted URL; deleted records are excluded from learning handoff.

## State Model

The MVP status model is:

- `review_needed`: generated by `/ohayo`, not approved yet.
- `approved`: reviewed and ready to schedule.
- `scheduled`: has scheduled datetime and is eligible for posting workflow.
- `posted`: posted URL has been recorded.
- `skipped`: intentionally not used.
- `learning_ready`: metrics or reaction notes are ready to become learning candidates.
- `deleted`: the post existed on X but was later deleted; `posted_url` remains as history, and `deleted_at`, `deletion_source`, `deletion_reason` capture the operational reason.

## Data Boundary

SNS Posting Ledger stores operational state:

- post body and revisions
- generated date and slot
- source references
- review and schedule state
- posted URL
- deletion timestamp/source/reason for posts removed on X
- metrics snapshots
- learning candidate linkage

Graph stores durable knowledge only after promotion:

- people
- brands
- decisions
- philosophy
- glossary terms
- promoted learnings

## Implementation Slice: Ship Calendar Visual Surface

The first UI implementation slice may ship the Ship Calendar visual surface before the durable ledger/API is connected.

This slice is allowed to:

- render a static `/sns-growth.html` page that matches the accepted Ship Calendar visual direction
- expose it from the Brainbase activity bar as an additive navigation entry
- open from the Brainbase activity bar as an in-shell workspace panel, not as a one-way page navigation
- show fixture post records for layout, status badges, detail panel, source URL, and evidence rows
- use Brainbase design tokens and dark command surface treatment instead of a standalone light admin palette
- keep all post actions local/no-op until the ledger API slice exists

This slice must not:

- write to Graph
- pretend that the SNS Posting Ledger DB/API is complete
- replace the existing terminal/session/file-viewer navigation behavior
- remove the `Today` entry requirement for the final SNS Growth cockpit
- strand the operator on `/sns-growth.html` without a Brainbase panel path back to Sessions / Terminal

Architecture decision: ADR-012 records this visual slice. ADR-011 already defines the Graph/Ledger boundary, and this slice does not introduce a new data boundary, persistence mechanism, API contract, auth boundary, or runtime process.

## Implementation Slice: Feedback To Learning Surface

This slice connects posted Ledger records to the learning loop without writing raw metrics into Graph.

This slice is allowed to:

- record a metrics snapshot on a posted SNS Ledger record
- move an explicitly reviewed posted record to `learning_ready`
- show the latest metrics in the post detail panel
- keep deleted records out of learning handoff
- leave X API polling and anomaly notifier wiring for a later production slice

This slice must not:

- auto-promote metrics into Graph
- create a learning candidate from a deleted post
- mark a post `learning_ready` from the UI without feedback evidence

Activity bar requirement scope:

- `ab-sns-growth-btn` is the only new activity bar branch introduced by this slice.
- `ab-sns-growth-btn` opens `sns-growth-overlay` through `panel-layout-manager`, and must not use `window.location.href` from Brainbase Home.
- Existing `abSessionsBtn` behavior remains unchanged: clicking Sessions closes open panels and returns the existing session/terminal surface to the front.
- Mobile bottom navigation may expose an `SNS` entry, but it must open the same in-shell `sns-growth-overlay` and must not navigate to `/sns-growth.html`.
- Mobile SNS Growth starts from today's decision inbox; the full weekly Ship Calendar remains a supporting view on small screens.
- Existing Portal/Terminal behavior remains unchanged: `abPortalBtn`, `workspaceModeTerminalBtn`, `workspaceModePortalBtn`, and `portalBackTerminalBtn` continue to switch only the existing portal overlay and terminal surface.
- Existing file viewer close behavior remains unchanged: `targetSessionId` continues to mean the closed session or current session whose active file/root override is cleared before returning to terminal context.

## Task Candidates

| ID | Type | Title | Notes |
|----|------|-------|-------|
| TSK-sns-cockpit-001 | DB | SNS posting ledger schema | Separate PostgreSQL tables/schema from Graph; include idempotency for date+slot |
| TSK-sns-cockpit-002 | BE | Posting ledger repository and API | CRUD, status transitions, metrics, source evidence |
| TSK-sns-cockpit-003 | OPS | `/ohayo` persistence adapter | Save review pack into ledger after generation |
| TSK-sns-cockpit-004 | FE | Calendar cockpit view | Week/month view with status badges and daily density |
| TSK-sns-cockpit-005 | FE | Post detail review panel | Body editing, source links, quality evidence, status controls |
| TSK-sns-cockpit-006 | BE/OPS | Feedback handoff for `/oyasumi` | Posted records to metrics and learning candidates |
| TSK-sns-cockpit-007 | QA | Contract and UI tests | Idempotency, status transitions, calendar rendering, edit flow |
| TSK-sns-cockpit-008 | FE | Today overview entry | Initial screen with one current decision and compact week strip |
| TSK-sns-cockpit-009 | BE/FE/OPS | SNS publish bridge | UI calls Ledger publish endpoint; dry-run is non-mutating; public post requires confirmation and records posted URL |
| TSK-sns-cockpit-010 | BE/FE | Deleted post state | Add `deleted` Ledger status, preserve posted URL, and expose a confirmation action in the review panel |

## Verification Plan

- Unit: status transition rules, idempotent upsert, quality evidence persistence.
- API: create/list/update posts, schedule state, posted URL and metrics updates.
- API: publish bridge dry-run does not mutate Ledger; public publish requires explicit confirmation and stores posted URL.
- API/UI: posted records can be marked deleted while preserving posted URL and deletion metadata.
- Integration: `/ohayo` generated review pack becomes ledger records.
- UI: calendar shows planned posts and status badges; detail panel can edit, save, dry-run, and confirm publish.
- Regression: existing `/ohayo` markdown/signals output still works.
- Security: operator-only access for さとけい account data in MVP.
