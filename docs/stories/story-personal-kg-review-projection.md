# story-personal-kg-review-projection

## Title

Personal KG needs_review review and SNS projection

## Context

The local-to-server Personal KG migration has populated the server-side `memory_candidates` SSOT, but the owner still has `needs_review` candidates that cannot be used by SNS generation until a human decision is recorded.

This is an MCP/SSOT data story, not a UI story. The operator needs a safe local CLI that reads server-side owner-visible candidate-store records, does not print raw candidate body text, and separates human review, approval metadata, and SNS projection eligibility.

## User Story

As the owner of the Personal KG, I want a safe review queue for `needs_review` memory candidates and a projection eligibility report, so that I can decide what remains owner-only, what is rejected/expired/redacted, and what can later become `sns_ready` context without leaking private or counterparty-sensitive details.

## Acceptance Criteria

- ac:1 The CLI lists `needs_review` Personal KG candidates from `memory_candidates` with source refs, policy metadata, body length, and review reasons, but never prints raw candidate body text.
- ac:2 The review queue is owner-visible and candidate-store scoped: it filters by `owner_person_id`, `source_system`, and `permission_snapshot.oyasumi_meeting_personal_kg`, not Graph promotion state.
- ac:3 The projection report separates `eligible`, `already_sns_ready`, and `blocked` records, and blocks redacted, `needs_redaction`, rejected, expired, non-owner, non-internal, and `agency_level=none` candidates.
- ac:4 A decision file can be validated in dry-run mode for `approved`, `redacted`, `rejected`, and `expired` outcomes before any server write.
- ac:5 The CLI can run from fixture JSON without database access, so targeted tests and local dry-runs do not depend on the Lightsail tunnel.
- ac:6 Verification uses targeted unit tests and a CLI dry-run; browser/UI E2E is not required because this is an MCP/SSOT data CLI story.

## Out Of Scope

- Creating a new Personal KG UI.
- Posting to SNS or creating SNS drafts.
- Promoting candidate-store records to Graph SSOT.
- Rewriting candidate body text or exposing raw body text in stdout.

## Links

- Architecture: `docs/architecture/personal-kg-review-projection-architecture.md`
- Spec: `docs/specs/personal-kg-review-projection-spec.md`
