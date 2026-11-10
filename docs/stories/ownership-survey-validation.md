# Keep ownership survey checks with their reusable implementation

UNS-59: callers maintaining a migration ledger need to reject stale surveys using the OSS package instead of keeping reusable validation code in tenant configuration.

The validator accepts caller-owned ledger and survey data and returns deterministic diagnostics. Pending migration paths, retained sources, lifecycle, wave and disposition checks retain the established contract. Data refresh and production readback remain caller responsibilities.

See [the specification and integration order](../specs/ownership-survey-validation.md). Scope changed under the 2026-11-03 12:30 JST project decision: move code from unson #2631 to brainbase, open a PR, obtain green CI, request independent acceptance review, and do not merge.
