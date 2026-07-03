# Requirement Consistency

| 項目 | 内容 |
|------|------|
| Status | pass |
| Invariants | 13 |
| Scenario Gaps | 0 |
| Contradictions | 0 |
| Scanned Code Files | 0 |
| Requirement Sources | 1 |
| Spec Refs | 1 |
| Architecture Refs | 0 |
| Policy Refs | 0 |
| Domain Contract Refs | 0 |
| Responsibility Authority Matches | 0 |
| Responsibility Authority Unknowns | 0 |

## Invariants

- INV-001: The meeting source sync worker must poll Tactiq and Plaud directly from persisted provider cursors without requiring Calendar event data. (inferred_spec:docs/stories/story-meeting-source-mcp-sync-worker.md)
- INV-002: Provider poll failures must be recorded per provider and must not be converted into an empty meeting result set. (inferred_spec:docs/stories/story-meeting-source-mcp-sync-worker.md)
- INV-003: Every raw Tactiq or Plaud provider artifact used for generation must be normalized with provider source id, MCP resource URI, timestamps, title, content hash, and text availability status. (inferred_spec:docs/stories/story-meeting-source-mcp-sync-worker.md)
- INV-004: Tactiq and Plaud artifacts that represent the same conversation must produce one source cluster and must not produce duplicate Meeting Packs. (inferred_spec:docs/stories/story-meeting-source-mcp-sync-worker.md)
- INV-005: The sync worker must create source_event and optional supporting_source_events before submitting a Review Package to review-ingest. (inferred_spec:docs/stories/story-meeting-source-mcp-sync-worker.md)
- INV-006: Calendar and Slack may enrich meeting identity or evidence references but must not replace missing Tactiq or Plaud transcript and note facts. (inferred_spec:docs/stories/story-meeting-source-mcp-sync-worker.md)
- INV-007: Project and People SSOT resolution must run before Meeting Pack generation writes project-scoped context or default task owners. (inferred_spec:docs/stories/story-meeting-source-mcp-sync-worker.md)
- INV-008: Mac Companion MCP settings responses must expose provider metadata and must not return raw secret values after save. (inferred_spec:docs/stories/story-meeting-source-mcp-sync-worker.md)
- S-001: Given Plaud contains an offline or phone conversation with no Calendar event, when the cron worker polls Plaud, then it creates a source artifact and Meeting Pack candidate from the Plaud note or transcript. (inferred_spec:docs/stories/story-meeting-source-mcp-sync-worker.md)
- S-002: Given Tactiq and Plaud both contain the same online meeting, when dedupe runs, then the system creates one source cluster with one primary source and supporting source events. (inferred_spec:docs/stories/story-meeting-source-mcp-sync-worker.md)
- S-003: Given an operator requests manual replay from Mac Companion settings, when dry-run preview has not been confirmed with bounded filters, then replay must not submit Review Packages. (inferred_spec:docs/stories/story-meeting-source-mcp-sync-worker.md)
- C-001: The provider settings API must return enabled, auth_status, capabilities, account_label, last_success_at, last_error, and cursor metadata for each MCP provider. (inferred_spec:docs/stories/story-meeting-source-mcp-sync-worker.md)
- C-002: Provider cursors must advance only after artifact normalization and enqueue or ingest outcome are durably persisted. (inferred_spec:docs/stories/story-meeting-source-mcp-sync-worker.md)

## Scenario Gaps

- なし

## Potential Contradictions

- なし

## Requirement Sources

- spec: docs/specs/story-meeting-source-mcp-sync-worker-spec.md: Meeting Source MCP Sync Worker Spec

## Responsibility Authority

- status: not_generated
- matched responsibilities: 0
- matched contract clauses: 0
- missing evidence: 0
- stale evidence: 0
- unregistered candidates: 0
