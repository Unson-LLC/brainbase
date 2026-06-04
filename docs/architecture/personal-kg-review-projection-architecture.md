# Personal KG Review Projection Architecture

## Center Pin

Human review needs a safe operating queue, not another source of truth. The CLI reads `memory_candidates`, projects only metadata needed for decisions, and never turns raw conversation or candidate body text into stdout.

## Boundaries

- Source of truth: `INFO_SSOT_DATABASE_URL.memory_candidates`.
- Canonical entities/projects: Brainbase Graph SSOT remains primary for names and project identity.
- Review CLI: local operator tool under `scripts/personal-kg-review-projection.js`.
- SNS generation context: still reads only `memory_layer=sns_ready` through existing SNS context filtering.

## Read Model

The CLI reads candidate-store rows with:

- `owner_person_id`
- `source_system`
- `permission_snapshot.oyasumi_meeting_personal_kg`
- ACL fields: `visibility`, `sensitivity`, `role_min`, `agency_level`
- lifecycle fields: `promotion_status`, `requires_approval`, `redaction_status`, `expires_at`
- provenance fields: `source_event_ids`, `project_code`, `project_ids`, `evidence_ids`
- `LENGTH(body)` only, not `body`, in database mode

Fixture mode may load `body` from JSON to compute length, but output functions must omit it.

## Review Queue

A candidate is in the review queue when at least one condition holds:

- `memory_layer=needs_review`
- `extraction_decision=needs_review`

The default scope is intentionally `needs_review` because routine redaction and promotion approval candidates are much larger queues. Operators can use `--review-scope redaction` for `redaction_status=needs_redaction`, or `--review-scope all` to combine both. `requires_approval=true` alone is not a review queue reason because newly-created Personal KG candidates commonly need promotion approval. Operators can include those routine approval candidates with `--include-approval-candidates`.

The queue emits only safe summaries and review reasons.

## Projection Report

The projection report classifies candidates as:

- `eligible`: owner-visible `personal_kg_core`, `internal`, `redaction_status=none`, active lifecycle, `agency_level!=none`, and `projection_allowed` is not false.
- `already_sns_ready`: owner-visible `sns_ready` candidates that are active and non-redacted.
- `blocked`: candidates with explicit blocker reasons.

Projection report is a plan only. It does not create `sns_ready` bodies because doing that safely requires body-level redaction and human review.

## Decision File

Decision dry-run accepts:

- `approved`
- `redacted`
- `rejected`
- `expired`

The decision plan validates status transitions before any write. If `--write` is used, writes are limited to candidate metadata/status and append-only audit events; no Graph promotion and no SNS body generation happen in this story.

## Verification

- Unit tests cover safe output, review selection, projection blockers, and decision dry-run validation.
- CLI contract test runs against a fixture JSON file.
- No UI/browser E2E is required for this MCP/SSOT CLI story.
