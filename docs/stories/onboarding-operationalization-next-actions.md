---
story_id: onboarding-operationalization-next-actions
title: Onboarding operationalization next actions
source:
  type: issue
  origin: https://github.com/Unson-LLC/brainbase/issues/426
  date: 2026-06-08
spec_docs:
  - path: docs/specs/onboarding-operationalization-next-actions-spec.md
architecture_docs:
  - status: not_required
    reason: This changes deterministic onboarding CLI output, docs, and agent instructions only. It does not add storage schema, live scheduler writes, hosted services, or MCP runtime boundaries.
status: in_progress
---

# Onboarding operationalization next actions

## Background

The first value demo now proves that local Brainbase context can produce a useful output. That is still not the same as an operational onboarding finish. Users also need the public skills, daily routines, real MCP config merge, and source allowlist / candidate review path.

If the agent reports completion at `doctor.ready=true` or `first_value_demo_ready`, users do not learn what remains to make Brainbase work in later sessions.

## User Story

As a first-time Brainbase adopter, I want the completion report after the first value demo to show the remaining operational setup, so that I can move from a successful demo to a working daily Brainbase loop without knowing internal command names.

## Scope

- Add an operationalization next-action block to first value demo output.
- Add the same operationalization block to guided first-run output.
- Expose the operationalization checklist from `doctor`.
- Update agent instructions and README so agents do not treat existing commands as completed onboarding.
- Keep all listed setup actions dry-run / generation-only unless the user explicitly approves writes.

## Acceptance Criteria

- [ ] `onboard:demo --format json` after a ready first value demo includes pending actions for public skills, routines, MCP config merge, source allowlists / import / candidate review, and doctor plus MCP `get_context` / `search` verification.
- [ ] Markdown `onboard:demo` shows the same unfinished operationalization actions after the first value output.
- [ ] `onboard:start --format json` includes operationalization next commands in the recommended order: skills, routines with pause/confirmation, MCP config merge, verification, then optional project/source follow-up.
- [ ] `doctor` exposes an `operationalization` section so agents cannot collapse onboarding to `valueDemo.ready`.
- [ ] AGENTS.md, CLAUDE.md, and README state that commands existing in the product are not enough; completion reports must present the remaining skills/routines/MCP/source-review tasks.
- [ ] Existing local-first safety remains: no live config writes, no scheduler registration, and no canonical source promotion by default.
