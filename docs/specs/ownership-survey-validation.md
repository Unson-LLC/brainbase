# Ownership survey validation (UNS-59)

The OSS package owns the pure `@unson/brainbase-mcp/ownership-survey` validator. Call `validateOwnershipSurvey(contract, survey)` with caller-owned JSON. It performs no filesystem, hosted-service, production, or database access. A missing optional survey preserves the existing empty-diagnostics contract; consumers must separately require/load their configured survey.

Every pending component requires a survey entry with the established wave, duplication, production-use and disposition vocabulary. Survey IDs must refer to pending or retired ledger components. Pending files must exactly match the union of current paths and retained sources, including external package references. Duplicate entries and paths fail. `readback_and_close` records removed source copies without changing ledger lifecycle or claiming production verification. Diagnostics use JavaScript's locale-independent string sort for stable ordering across input permutations.

Acceptance: preserve the checks introduced in unson PR #2631, cover stale/missing/duplicate paths and canonical/unknown IDs, and prove input ordering cannot alter diagnostic ordering. Build and existing package CI must pass.

Integration order:

1. Review this OSS PR and obtain green CI; leave merge to the designated reviewer/maintainer. No publication or deployment is part of this issue.
2. Publish an approved OSS version containing the export through the normal release process.
3. Update the tenant configuration consumer to that version and import the validator from the package; remove the copied validator in the same consumer change. Keep the tenant ledger, survey snapshot and readback evidence in that private configuration repository. Re-run its classification and closeout checks.
4. Maintainer closes superseded unson PR #2631 after the consumer replacement is tracked. Its survey refresh is still a proposal, not merged evidence. Preserve its original measurement dates and unresolved production readback.

Historical source: unson PR #2631 head `7fbfe81d93e6b0e60f5d69e7474c3192e5b853eb`. No tenant snapshot, production claim, or tenant operation is copied into OSS. The original tenant PostgreSQL test failure is outside this pure validator and is not claimed fixed here.
