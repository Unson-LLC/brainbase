---
spec_id: SPEC-sns-persona-brain-gate
title: SNS Persona Brain Gate Specification
status: draft
date: 2026-05-11
story_id: story-sns-persona-brain-gate
related_specs:
  - SPEC-sns-readonly-curator
implementation_files:
  - server/services/sns/sns-readonly-curator.js
test_files:
  - tests/sns/curator/**/*.test.js
---

# SPEC: SNS Persona Brain Gate

## Purpose

SNS drafts must be generated from the target persona's mental model before copy is saved for review.

`pillar`, `lane`, and deterministic score are operational classifications. They are not sufficient to publish or review a draft. The curator must require a `persona_brain` object that explains the reader's current mental state and the intended shift.

## Business Metric

Primary metric: percentage of saved SNS curator candidates that include complete persona brain review evidence. The target for this story is 100% for curator-generated candidates.

## Object Contract

```ts
type PersonaBrain = {
  target_person: string;
  current_situation: string;
  existing_belief: string;
  misunderstanding: string;
  fear: string;
  blocker: string;
  resonant_detail: string;
  avoid_phrasing: string;
  natural_next_action: string;
  success_signal: string;
};
```

All fields are required non-empty strings.

## Invariants

- **INV-1**: `generateDrafts` returns only drafts with a valid `persona_brain`.
- **INV-2**: `saveDraftsToCandidateStore` rejects drafts with missing or incomplete `persona_brain` before candidate-store mutation.
- **INV-3**: saved candidates include `persona_brain` in `permission_snapshot.sns.persona_brain` for review evidence.
- **INV-4**: validation is deterministic and does not call an LLM.
- **INV-5**: curator keeps the existing read-only posting boundary and candidate-store write boundary.

## Contract

`SnsReadonlyCurator` accepts an optional `personaBrainProvider` dependency:

```ts
type PersonaBrainProvider = (source: Entity, viewer: JWT) => PersonaBrain | null;
```

When no provider is passed, the curator derives a deterministic fallback from source metadata and viewer context. Tests may pass an explicit provider to verify rejection behavior.

## Scenarios

### S-1: Draft generation attaches persona brain

- given: a valid source insight and viewer
- when: `generateDrafts`
- then: every returned draft has a valid `persona_brain`

### S-2: Save stores persona brain review evidence

- given: a draft with valid `persona_brain`
- when: `saveDraftsToCandidateStore`
- then: candidate `permission_snapshot.sns.persona_brain` equals the draft persona brain

### S-3: Missing persona brain is rejected before mutation

- given: a draft without `persona_brain`
- when: `saveDraftsToCandidateStore`
- then: an error is thrown and no candidate is created

## Anti-patterns

- Saving a copy-only draft and asking reviewers to infer the persona later.
- Treating content pillar / lane as a substitute for persona brain.
- Calling a nondeterministic LLM to validate the required fields.
