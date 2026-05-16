---
adr_id: ADR-014
title: Settings config write boundary
status: accepted
date: 2026-05-16
related_stories:
  - story-settings-contract-alignment
related_specs:
  - docs/specs/story-settings-contract-alignment-spec.md
  - docs/specs/settings-phase0-guards-spec.md
  - docs/specs/settings-plugin-contract-v2-spec.md
supersedes: []
superseded_by: []
---

# ADR-014: Settings config write boundary

## Context

Settings owns user-facing configuration edits for projects, organizations, notifications, and legacy integration mappings. These writes mutate shared `config.yml` state and must not rely on UI-only `requiredLevel` checks or one-off fetch calls.

The existing Settings story map requires:

- shared `HttpClient` use for CSRF handling,
- server-side authentication and GM/CEO authorization for config writes,
- cache invalidation after config writes,
- provider/account contracts to stay server-side rather than inside the Settings UI registry.

## Decision

Settings keeps the existing UI plugin registry for tab rendering only. Config writes cross the backend boundary through `/api/config` and are protected there.

- Browser Settings code uses the shared `HttpClient` abstraction for config API calls.
- `/api/config` mutating routes apply shared auth middleware plus a config write role guard.
- `ConfigService` receives the runtime `ConfigParser` instance and invalidates its cache after file writes.
- Provider/account capability remains in `server/services/account/*`; Settings UI may surface account state, but credential/OAuth authority does not move into `settings-plugin-api.js`.

## Consequences

- CSRF behavior is centralized in `HttpClient`.
- All config write routes have the same server-side trust boundary.
- Cache freshness is guaranteed by runtime wiring, not only by isolated helper tests.
- Future Accounts subviews can be added to Settings without making the UI registry an auth or credential authority.

## Non-goals

- This ADR does not introduce a new Settings UI layout.
- This ADR does not change the account/default model from ADR-008.
- This ADR does not store credential secret values in `config.yml`, localStorage, or logs.
