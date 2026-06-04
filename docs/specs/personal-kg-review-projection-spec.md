# Personal KG Review Projection Spec

## Invariants

- INV-001: Safe summaries never include raw `body` text.
- INV-002: Database mode reads candidate body length, not candidate body text.
- INV-003: Review queue is scoped by `owner_person_id`, `source_system`, and `permission_snapshot.oyasumi_meeting_personal_kg`.
- INV-004: Default review queue inputs are `memory_layer=needs_review` and `extraction_decision=needs_review`. `redaction_status=needs_redaction` records are included with `--review-scope redaction` or `--review-scope all`. Active `requires_approval` records are included only when `--include-approval-candidates` is set.
- INV-005: SNS projection eligibility requires owner visibility, `memory_layer=personal_kg_core`, active lifecycle, `sensitivity=internal`, `redaction_status=none`, `agency_level!=none`, and `projection_allowed!==false`.
- INV-006: `sns_ready` records are reported as already projected, not rewritten.
- INV-007: Rejected, expired, non-owner, redacted, `needs_redaction`, non-internal, and `agency_level=none` records are blocked from SNS projection with explicit reasons.
- INV-008: Decision dry-run validates the requested outcome and status transition before write.
- INV-009: `approved` from `candidate` requires the monotonic transition `candidate -> pending_approval -> approved`.
- INV-010: Fixture JSON mode is available without database credentials.

## CLI Contract

```bash
npm run personal-kg:review-projection -- --json
npm run personal-kg:review-projection -- --projection-plan --json
npm run personal-kg:review-projection -- --input-json fixture.json --decision-file decisions.json --json
```

## JSON Output Shape

```json
{
  "mode": "personal_kg_review_projection",
  "source_system": "oyasumi-meeting-personal-kg",
  "owner_person_id": "sato_keigo",
  "summary": {
    "input_candidates": 0,
    "review_candidates": 0,
    "projection_eligible": 0,
    "projection_blocked": 0,
    "already_sns_ready": 0
  },
  "review_queue": [],
  "projection_plan": null,
  "decision_plan": null
}
```

## Acceptance Mapping

- ac:1 -> INV-001, INV-002, INV-004
- ac:2 -> INV-003
- ac:3 -> INV-005, INV-006, INV-007
- ac:4 -> INV-008, INV-009
- ac:5 -> INV-010
- ac:6 -> Unit and CLI contract verification
