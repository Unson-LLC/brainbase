---
story_id: story-sns-persona-brain-gate
title: SNS drafts require persona brain before copy
status: draft
date: 2026-05-11
related_specs:
  - SPEC-sns-readonly-curator
---

# Story: SNS Persona Brain Gate

## User Story

As a growth operator using brainbase SNS curation,
I want every recommended SNS draft to carry the target persona's mental model before copy is produced,
so that posts are shaped from the reader's fear, misunderstanding, and natural next action instead of from internal content pillars alone.

## Context

SNS operations for さとけい and customer support work such as BAAO / グローウィン both depend on the same marketing method: think from the target persona's brain first, then choose pillar, lane, copy, and CTA.

The existing SNS curator can recommend draft candidates from Graph sources, score them deterministically, and save them to candidate-store. It does not yet require a persona brain record, so a draft can be created from source material and scoring alone.

## Business Context

The growth method is only useful if each post can explain which persona it moves and why. The success signal for this story is reviewability: a reviewer can inspect a candidate and see the persona's current situation, misunderstanding, fear, blocker, and next action without inferring them from the copy.

## Acceptance Criteria

- [ ] AC-1: A generated SNS draft includes a `persona_brain` object before it can be saved.
- [ ] AC-2: `persona_brain` captures at least: target person, current situation, belief, misunderstanding, fear, blocker, resonant concrete detail, avoided phrasing, natural next action, and success signal.
- [ ] AC-3: Saving a draft without `persona_brain` is rejected before candidate-store mutation.
- [ ] AC-4: The persona brain is stored in candidate evidence / snapshot so review can audit why the copy should move that persona.
- [ ] AC-5: Curator remains read-only for posting and still writes only through candidate-store.

## Non-goals

- Do not add posting execution.
- Do not call an LLM to infer persona brain in tests.
- Do not write to `_codex/sns/drafts/` from the curator.
