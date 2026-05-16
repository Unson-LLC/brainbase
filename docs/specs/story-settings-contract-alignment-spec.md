---
spec_id: SPEC-story-settings-contract-alignment
title: Settings Contract Alignment Specification
status: draft
date: 2026-05-16
story_id: story-settings-contract-alignment
related_specs:
  - SPEC-settings-phase0-guards
  - SPEC-settings-plugin-contract-v2
related_adrs:
  - ADR-014
implementation_files:
  - public/modules/settings/settings-core.js
  - server/routes/config.js
  - server/bootstrap/core-services.js
  - server/services/config-service.js
  - server/services/account/provider-registry.js
test_files:
  - tests/settings/phase0/**/*.test.js
  - tests/settings/provider-contract/**/*.test.js
---

# SPEC: Settings Contract Alignment

## Invariants

- **INV-1**: `CoreApiClient` delegates settings/config HTTP calls to the shared `HttpClient` API (`get`, `post`, `put`, `delete`) and does not call raw `fetch`.
- **INV-2**: Every `/api/config` mutating route is protected by server-side authentication and GM/CEO role checks.
- **INV-3**: Config writes invalidate the same `ConfigParser` instance used by runtime reads.
- **INV-4**: Provider contract tests exist at the path declared by `SPEC-settings-plugin-contract-v2`.

## Contracts

- **C-1**: `new CoreApiClient(client)` accepts an HttpClient-compatible dependency for testability and defaults to the shared singleton.
- **C-2**: `createConfigRouter` applies the same auth/write guards to `projects`, `organizations`, `notifications`, `github`, and `nocodb` write routes.
- **C-3**: `createCoreServices` passes `configParser` into `ConfigService`.

## Scenarios

- **S-1**: A Settings project update uses `HttpClient.post('/api/config/projects', payload)`.
- **S-2**: An unauthenticated request to any Settings write route returns `401`.
- **S-3**: A member request to any Settings write route returns `403`.
- **S-4**: A config write calls `ConfigParser.invalidateCache()` after the file write.

## Anti-patterns

- **AP-1**: `CoreApiClient` calls raw `fetch`, bypassing shared CSRF handling.
- **AP-2**: Some Settings write routes are guarded while others remain open.
- **AP-3**: Tests assert only that helper code exists, without checking runtime wiring.

## Verification

| Clause | Test |
|---|---|
| INV-1, C-1, S-1, AP-1 | `tests/settings/phase0/inv-1-http-client-csrf.test.js`, `tests/settings/phase0/ap-1-raw-fetch.test.js` |
| INV-2, C-2, S-2, S-3, AP-2 | `tests/settings/phase0/inv-2-config-auth.test.js`, `tests/settings/phase0/ap-2-ui-only-permission.test.js` |
| INV-3, C-3, S-4, AP-3 | `tests/settings/phase0/inv-4-cache-invalidation.test.js`, `tests/settings/phase0/s-5-cache-fresh-after-write.test.js` |
| INV-4 | `tests/settings/provider-contract/**/*.test.js` |
