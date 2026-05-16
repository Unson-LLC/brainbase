---
story_id: story-settings-contract-alignment
title: Settings contracts match story and runtime behavior
status: in_progress
created_at: 2026-05-16
updated_at: 2026-05-16
related_specs:
  - docs/specs/story-settings-contract-alignment-spec.md
  - docs/specs/settings-phase0-guards-spec.md
  - docs/specs/settings-plugin-contract-v2-spec.md
architecture_docs:
  - docs/architecture/ADR-014-settings-config-write-boundary.md
---

# Story: Settings contracts match story and runtime behavior

## Background

Settings is the entry point for config, integrations, and account-related operations. The existing story map and specs require Settings writes to use the shared HTTP/auth boundary, provider contracts to be explicit, and runtime config writes to invalidate cached config.

## Acceptance Criteria

- Core Settings API calls use the shared `HttpClient` so mutating requests receive CSRF handling.
- Every Settings config write route is guarded server-side by authentication and GM/CEO role checks.
- Config writes invalidate `ConfigParser` cache in the actual runtime wiring, not only in isolated tests.
- Provider contract tests exist under the path declared by the provider contract spec.
- VibePro PR evidence can trace these clauses without falling back to an implicit generic spec.
