---
spec_id: spec-m3-judgment-value-proof-surface
story_id: story-m3-judgment-value-proof-surface
status: accepted
architecture: docs/architecture/judgment-value-proof-surface.md
contract_schema: contracts/judgment-value-proof/schema.json
contract_fixture: contracts/judgment-value-proof/fixture.json
canonical_story: docs/management/stories/active/story-m3-judgment-value-proof-surface.md
---

# Spec: M3 Judgment Value Proof Surface

## Inputs

Projection producer supplies one `JudgmentValueProof` per decision attempt. It must bind the record to one `intent_id` and one `decision_attempt_id` and preserve evidence states without guessing.

## Placement

1. `not_applicable` with no feedback, block, or outcome is silent and excluded from weekly digest.
2. `continued_without_human + executing` produces one agent progress line.
3. `continued_without_human + completed` produces one agent completion receipt.
4. `human_required` produces a structured human decision request and Companion attention item.
5. `blocked`, completed-but-unconfirmed, and pending feedback produce Companion attention items.
6. Web placement is always `none`; browser-only bootstrap/recovery remains outside this contract.

## Default rendering

Completion rendering order is result, decision, work impact, applied basis, outcome state, human-readable evidence label, correction command. Internal identifiers remain available in the projection but are not printed by default renderers.

## Validation

- `continued_without_human` requires a decision summary and either redacted question text or question digest.
- `human_required` requires a human decision object.
- `outcome_verified` requires an outcome summary and at least one verified evidence ref.
- recorded feedback requires an evidence ref.

## Failure semantics

Invalid projections throw and must not be rendered as success. `unavailable`, `unconfirmed`, and `not_applicable` remain distinct.
