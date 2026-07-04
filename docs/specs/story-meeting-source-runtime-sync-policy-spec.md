---
story_id: story-meeting-source-runtime-sync-policy
title: Meeting Source Runtime Sync Policy Spec
status: active
created_at: 2026-07-04
updated_at: 2026-07-04
diagrams:
  - kind: flow
    path: docs/architecture/story-meeting-source-runtime-sync-policy-architecture.md
    purpose: Mac Companionからprovider-only previewを受け、Brainbase runtimeがcursor/backfill/overlapから同期範囲を決める流れを示す。
  - kind: threat_model
    path: docs/architecture/story-meeting-source-runtime-sync-policy-architecture.md
    purpose: credential refと同期範囲の正本がMac Companionへ分散しない信頼境界を示す。
    mermaid: |
      flowchart LR
        Mac["Mac Companion"] --> Runtime["Brainbase runtime API"]
        Runtime --> State["Provider state / cursor"]
        Runtime --> Adapters["Tactiq/Plaud MCP adapters"]
        Adapters --> External["External MCP providers"]
        Runtime --> Workflow["Meeting Pack ingest"]
        Mac -. "must not create updated_since or store credential refs" .-> Boundary["Trust boundary"]
---

# SPEC: Meeting Source Runtime Sync Policy

## Diagrams

- kind: flow
  path: `docs/architecture/story-meeting-source-runtime-sync-policy-architecture.md`
  purpose: Mac Companionからprovider-only previewを受け、Brainbase runtimeがcursor/backfill/overlapから同期範囲を決める流れを示す。
- kind: threat_model
  path: `docs/architecture/story-meeting-source-runtime-sync-policy-architecture.md`
  purpose: credential refと同期範囲の正本がMac Companionへ分散しない信頼境界を示す。

## Invariants

- INV-1: Mac Companion must not be the owner of Meeting Source sync cadence, cursor, or backfill range.
- INV-2: Brainbase runtime owns `sync_policy` and exposes it to clients.
- INV-3: Tactiq is the primary source for online meetings. Plaud.ai is the primary source for offline meetings, calls, and online meetings where Tactiq is unavailable.
- INV-4: Calendar data is context-only. It must not be required to discover meetings or calls.

## Contracts

- C-1: `GET /api/settings/meeting-sources/mcp-providers` returns:
  - `providers`
  - `sync_policy.trigger_interval_minutes`
  - `sync_policy.incremental_cursor_field`
  - `sync_policy.overlap_window_hours`
  - `sync_policy.initial_backfill_since`
  - `sync_policy.calendar_role`
  - `sync_policy.source_priority`
- C-2: `POST /api/settings/meeting-sources/resync-preview` accepts `{ "providers": [...] }` without `since`, `until`, or `updated_since`.
- C-3: For a provider without `cursor.updated_since`, runtime resolves `updated_since` to `2026-06-25T00:00:00.000Z`.
- C-4: For a provider with `cursor.updated_since`, runtime resolves `updated_since` to `cursor.updated_since - 24h`, clamped to the initial backfill date.
- C-5: Preview responses include `sync_policy` and `sync_policy_mode` so clients can display whether the range came from runtime policy or an explicit request.

## Scenario Clauses

- S-1: The Mac Companion settings screen loads provider statuses and renders Brainbase runtime's `sync_policy` without receiving raw credential refs.
- S-2: A provider-only preview for a provider with no cursor starts at `2026-06-25T00:00:00.000Z`.
- S-3: A provider-only preview after successful ingest starts at `cursor.updated_since - 24h`, clamped to `2026-06-25T00:00:00.000Z`.
- S-4: The scheduled sync worker uses the same runtime policy as manual preview so cron execution and UI preview do not diverge.
- S-5: Calendar data can enrich a Meeting Pack but is not required to discover meetings, calls, or offline recordings.

## Anti-Patterns

- AP-1: Rejecting `{ providers: [...] }` preview requests because no explicit range was supplied.
- AP-2: Requiring Mac Companion to calculate `updated_since`.
- AP-3: Treating calendar events as the only meeting discovery source.
- AP-4: Hiding sync frequency/range policy from clients.

## Verification

- V-1: Route test covers provider status response including `sync_policy`.
- V-2: Route test covers providers-only preview resolving to the initial backfill date.
- V-3: Route test covers providers-only preview after a stored cursor, resolving to `cursor.updated_since - 24h`.
- V-4: Existing confirm path remains able to ingest explicit-window previews.
- V-5: E2E contract covers AC-1 through AC-6 against the HTTP route surface and verifies no legacy explicit-window rejection remains.
