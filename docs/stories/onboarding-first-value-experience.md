---
story_id: onboarding-first-value-experience
title: Onboarding first value experience output
source:
  type: issue
  origin: https://github.com/Unson-LLC/brainbase/issues/424
  date: 2026-06-08
spec_docs:
  - path: docs/specs/onboarding-first-value-experience-spec.md
architecture_docs:
  - path: docs/architecture/value-first-onboarding.md
    status: not_required
    reason: Existing value-first onboarding CLI boundary is reused; this changes deterministic CLI output and agent instructions only, with no new MCP server, storage schema, provider connector, hosted backend, or data-flow boundary.
status: in_progress
---

# Onboarding first value experience

## Story

As a first-time Brainbase adopter, I want onboarding to show one natural prompt and one useful answer from the context I just approved, so that I can feel the value before learning Brainbase internals.

## User Value

The first value moment is not a green readiness flag. It is:

1. The user says one thing they hate re-explaining.
2. Brainbase saves the smallest approved local memo.
3. Brainbase gives the user one natural prompt to try.
4. Brainbase shows a sample answer that uses the saved memo.
5. The user can see what they no longer had to explain.

## Requirement Sources

- issue: https://github.com/Unson-LLC/brainbase/issues/424
- specification: docs/specs/onboarding-first-value-experience-spec.md
- related story: docs/stories/value-first-onboarding.md

## Scope

In scope:

- Add user-facing first value fields to `onboard:demo`.
- Add a first value experience block to `onboard:start`.
- Update agent instructions so `ready: true` is not treated as completion without a useful output.
- Keep the demo deterministic and local.

Out of scope:

- Hosted backend setup.
- UI onboarding.
- OAuth flows.
- LLM generation.
- Raw source import.

## Acceptance Criteria

- [ ] `onboard:start --format json` includes a first value experience block with a natural prompt, expected value, and sample result.
- [ ] `onboard:demo --format json` includes `tryPrompt`, `sampleResult`, and `valueExplanation`.
- [ ] Ready demo output avoids requiring the user to understand Graph, Personal KG, relationship records, or SSOT before seeing value.
- [ ] Agent instructions say `ready: true` is not enough; the agent must show the first useful output from the saved context.
- [ ] Tests include spec clause IDs for the first value experience.
