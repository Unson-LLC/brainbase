---
story_id: story-meeting-source-mcp-sync-worker
title: Meeting Source MCP Sync Worker Spec
status: active
created_at: 2026-07-02
updated_at: 2026-07-03
diagrams:
  - kind: dag
    path: docs/architecture/meeting-source-mcp-sync-worker-architecture.md
    purpose: cron worker, provider polling, dedupe, SSOT resolution, Review Package submission, and settings UI flow.
  - kind: data_model
    path: docs/architecture/meeting-source-mcp-sync-worker-architecture.md
    purpose: provider config, cursor, source artifact, source cluster, and review package relationship.
---

# Meeting Source MCP Sync Worker Spec

## Contract

The system must add a provider-first Meeting Pack source synchronization path:

1. `meeting-source-sync-worker` runs by cron.
2. The worker loads enabled MCP provider configs for Tactiq and Plaud.
3. The worker polls each provider independently from its cursor with an overlap window.
4. The worker normalizes raw provider records into `source_artifact` records.
5. The worker dedupes artifacts into `source_cluster` records.
6. The worker selects a primary source and supporting sources.
7. The worker resolves meeting identity, project, and people context.
8. The worker generates a Review Package with `source_event`.
9. The worker posts the Review Package to `/api/workflows/control/meeting-pack/review-ingest`.
10. The worker advances provider cursors only after durable persistence of normalization and enqueue/ingest outcome.

Calendar and Slack can enrich `meeting_identity` and `evidence_refs`, but they cannot become the fact source for meeting note, task, or decision generation.

Runtime bootstrap must create MCP provider adapters from `BRAINBASE_MEETING_SOURCE_MCP_ADAPTERS_JSON` and start the scheduler only when `BRAINBASE_MEETING_SOURCE_SYNC_ENABLED=1`. The worker must not submit generated Review Packages or advance provider cursors unless `org_id` and `project_id` are configured by env, request scope, or actor scope.

Runtime shutdown must invoke `stopScheduledSync()` for the Meeting Source MCP sync service from the graceful shutdown path. This cleanup is limited to the sync worker schedule timer and must complete before the remaining runtime services stop.

## Provider Config API

The Mac Companion settings UI requires backend APIs equivalent to:

- `GET /api/settings/meeting-sources/mcp-providers`
- `POST /api/settings/meeting-sources/mcp-providers/:provider/connect`
- `POST /api/settings/meeting-sources/mcp-providers/:provider/test`
- `POST /api/settings/meeting-sources/mcp-providers/:provider/disconnect`
- `POST /api/settings/meeting-sources/resync-preview`
- `POST /api/settings/meeting-sources/resync-confirm`

Provider status responses must include `enabled`, `auth_status`, `capabilities`, `account_label`, `last_success_at`, `last_error`, and cursor metadata. Responses must not include raw secrets.

## Source Artifact Schema

The normalized artifact must contain:

```json
{
  "provider": "tactiq",
  "provider_source_id": "transcript-123",
  "mcp_resource_uri": "mcp://tactiq/transcripts/123",
  "title": "Tech Knight 定例",
  "started_at": "2026-07-02T10:00:00+09:00",
  "ended_at": "2026-07-02T11:00:00+09:00",
  "updated_at": "2026-07-02T11:03:00+09:00",
  "content_sha256": "abc123",
  "has_text": true,
  "speaker_count": 4,
  "participant_hints": ["佐藤", "松村"],
  "calendar_event_id": null,
  "slack_permalink": null
}
```

## Review Package Source Event

The Review Package must include:

```json
{
  "source_event": {
    "source_system": "plaud",
    "source_kind": "recording_transcript",
    "meeting_mode": "offline_or_call",
    "source_id": "plaud-note-456",
    "source_cluster_id": "src-cluster-456",
    "mcp_resource_uri": "mcp://plaud/notes/456",
    "title": "大田原さん 電話",
    "started_at": "2026-07-02T14:00:00+09:00",
    "ended_at": "2026-07-02T14:20:00+09:00",
    "content_sha256": "def456",
    "calendar_event_id": null,
    "slack_permalink": null,
    "ingested_by": "meeting_source_mcp_sync_worker"
  },
  "supporting_source_events": []
}
```

## Workflow State Clauses

- WSC-001: cron worker loads provider configs and cursors before polling.
- WSC-002: Tactiq and Plaud polling failures are isolated per provider.
- WSC-003: provider poll responses are normalized before generation.
- WSC-004: `source_cluster` idempotency is checked before Review Package generation.
- WSC-005: primary source selection happens before meeting note generation.
- WSC-006: provider project/person hints are attached before Meeting Pack generation; authoritative Graph SSOT / People SSOT resolution and task owner defaults remain downstream workflow responsibilities.
- WSC-007: `source_event` is created by the worker and passed into review-ingest.
- WSC-008: cursors advance only after durable persistence.
- WSC-009: UI manual resync requires dry-run preview and bounded filters.
- WSC-010: UI provider status never returns raw secret values.
- WSC-011: server bootstrap wires configured MCP adapters into the worker.
- WSC-012: graceful shutdown stops the scheduled worker timer.
- WSC-013: missing org/project scope leaves scheduled sync in preview-only blocked state.
- WSC-014: graceful shutdown runs Meeting Source MCP worker cleanup before the remaining runtime services stop.

## Scenarios

- S-001: Tactiq has a complete online transcript and Plaud has no duplicate. The worker creates one Review Package with Tactiq as primary.
- S-002: Plaud has an offline conversation with no Calendar event. The worker still creates a Meeting Pack candidate.
- S-003: Tactiq and Plaud both contain the same online meeting. The worker creates one source cluster and one Review Package.
- S-004: Tactiq auth fails but Plaud succeeds. The worker records Tactiq auth failure and continues Plaud sync.
- S-005: Provider returns metadata but no transcript text. The artifact is recorded but not used as fact source.
- S-006: Project cannot be resolved. The worker records an explicit project blocker instead of guessing.
- S-007: Owner hint is ambiguous in People SSOT. Task owner remains unset with candidates.
- S-008: Operator opens settings UI, tests both provider connections, sees last sync/error state, runs bounded resync preview, then confirms.
- S-009: Scheduled sync is enabled but project scope is not configured. The worker records `scope_not_configured`, keeps the preview for inspection, and does not advance provider cursors.
- S-010: Mac Companion is shutting down while the Meeting Source MCP schedule is active. Graceful shutdown stops the scheduled worker timer and then proceeds with the remaining runtime services.

## Acceptance Tests

- `tests/server/meeting-source-mcp-sync-worker.test.js`
  - AC-001 AC-002 WSC-001 WSC-002: provider polling is independent and cursor-based.
  - AC-003 WSC-003: Tactiq/Plaud artifacts normalize into stable source artifact fields.
  - AC-004 AC-005 WSC-004 WSC-005: duplicate Tactiq/Plaud artifacts produce one source cluster and one primary source.
  - AC-006 WSC-007: generated Review Package includes `source_event` and `supporting_source_events`.
  - AC-012 WSC-008: cursors advance only after persistence.
- `tests/server/meeting-source-mcp-adapters.test.js`
  - WSC-011: env JSON creates supported Tactiq/Plaud MCP adapters only.
- `tests/server/routes/meeting-source-settings.test.js`
  - AC-009 AC-011 WSC-010: settings APIs expose provider metadata and no secret values.
  - AC-010 WSC-009: resync preview is required before confirm.
- `tests/e2e/story-meeting-source-mcp-sync-worker-contract.spec.ts`
  - AC-007 AC-008 S-002 S-006 S-007: no Calendar event is required, and unresolved project/owner cases are explicit.
  - S-008: Mac Companion settings UI supports connect/test/status/resync preview.
  - WSC-011 WSC-012 WSC-013 WSC-014 S-009 S-010: bootstrap, scheduled worker, shutdown, and scope guard remain wired.

## Release Operations

- Release note: Meeting Pack source sync now polls Tactiq/Plaud MCP directly and prepares Review Packages with source-event provenance.
- Operator action: configure Tactiq and Plaud MCP connections in Mac Companion settings, then enable cron schedule.
- Backfill action: run bounded dry-run replay for artifacts updated since 2026-06-25, inspect duplicate clusters and unresolved project/person cases, then confirm replay.
- Rollback instruction: disable cron schedule and provider configs. Existing Review Package ingest remains compatible with previously generated `source_event` metadata.
- Observability evidence: provider sync status, source artifact count, duplicate cluster count, Review Package submission count, cursor advancement logs.
