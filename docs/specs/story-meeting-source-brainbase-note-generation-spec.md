---
story_id: story-meeting-source-brainbase-note-generation
title: Meeting Source Brainbase Note Generation Spec
status: active
created_at: 2026-07-05
updated_at: 2026-07-05
diagrams:
  - kind: dag
    path: docs/architecture/meeting-source-brainbase-note-generation-architecture.md
    purpose: provider transcript, Brainbase source material, Review Package, and downstream Meeting Pack generation boundary.
---

# Meeting Source Brainbase Note Generation Spec

## Contract

Meeting Source MCP sync worker must produce Review Packages whose meeting note input is Brainbase-owned, transcript-backed, and provenance-safe.

The worker may receive several provider text fields:

- transcript fields: `text`, `transcript`, `transcript_text`
- provider note fields: `note_text`, `content`, `markdown`, `summary`, `ai_summary`, `meeting_summary`

Transcript fields are authoritative source text. Provider note fields are non-authoritative and must not be copied into `meeting_note_summary.body` as Brainbase minutes.
Artifacts without authoritative transcript text must not become Meeting Pack candidates. They may be counted as fetched provider artifacts and used to advance provider cursors, but they must not be submitted to Review Package ingest.
The preview API must expose these exclusions with `meeting_pack_exclusions[].reason` so an operator can tell whether the artifact was skipped because only provider-generated notes were available or because transcript text was missing.

## Source Artifact Fields

Normalized source artifacts must include:

```json
{
  "provider": "tactiq",
  "external_id": "tactiq-1",
  "mcp_resource_uri": "mcp://tactiq/transcripts/tactiq-1",
  "source_text": "full transcript text",
  "source_text_length": 20,
  "transcript_hash": "sha256-of-source-text",
  "has_text": true,
  "text_preview": "full transcript text",
  "raw_metadata": {
    "provider_note_authoritative": false,
    "provider_note_preview": "provider generated note preview"
  }
}
```

`text_preview` remains a UI/debug preview of the authoritative source text. It is not a complete meeting note and must not be the only text available to downstream generation.

The resync preview API must not return full `source_text` in `clusters[].primary_source` or `clusters[].supporting_sources[]`. Full transcript text is retained only in the persisted preview state for confirm-time Review Package generation.

## Review Package Meeting Note Summary

`_buildReviewPackageDraft` must build `meeting_note_summary` with the following contract:

```json
{
  "title": "Online strategy meeting",
  "body": "# Online strategy meeting\n\n...",
  "generator": "brainbase_meeting_pack",
  "generation_source": "transcript_to_meeting_note",
  "generation_status": "brainbase_source_ready",
  "provider_note_authoritative": false,
  "source_text_hash": "sha256-of-primary-transcript",
  "source_text_length": 20,
  "source_transcripts": [
    {
      "role": "primary",
      "provider": "tactiq",
      "mcp_resource_uri": "mcp://tactiq/transcripts/tactiq-1",
      "transcript_hash": "sha256-of-source-text",
      "text": "full transcript text",
      "authoritative_for_minutes": true
    }
  ],
  "source_event": {},
  "supporting_sources": []
}
```

The body may contain a Brainbase-owned draft seed or generated markdown, but it must not contain provider-generated note strings. The full transcript is carried in `source_transcripts` so downstream Brainbase generation can create or regenerate publishable minutes without returning to Tactiq/Plaud.

## Scenario Clauses

- S-001: transcript-backed Tactiq/Plaud artifacts are the only artifacts that can become Meeting Pack candidates.
- S-002: provider-generated notes, markdown, and summaries are non-authoritative metadata only.
- S-003: transcriptless provider note artifacts are fetched and reported, but excluded from Review Package ingest.
- SC-001: raw Tactiq artifact has `transcript_text` and `note_text`. The Review Package source text uses `transcript_text`; body does not contain `note_text`.
- SC-002: raw Plaud artifact has only `transcript_text`. The Review Package uses Plaud transcript as primary source text.
- SC-003: Tactiq and Plaud duplicate the same meeting. The primary transcript is role `primary`; duplicate transcript is role `supporting`.
- SC-004: provider transcript is empty. The artifact remains non-authoritative for minutes and is not used as a Meeting Pack source.
- SC-005: preview response returns source identity, hashes, lengths, and previews, but not full transcript text.
- SC-006: Graph/People/project resolution remains downstream; this story does not select task owners or graph nodes.
- SC-007: provider note-only artifact is returned in `artifact_count`, excluded from Meeting Pack candidates, and listed in `meeting_pack_exclusions` with `provider_note_available_without_transcript`.

## Acceptance Tests

- `tests/server/meeting-source-mcp-sync-worker.test.js`
  - AC-001 AC-002: normalized artifacts preserve full transcript and isolate provider notes.
  - AC-003 AC-004 AC-005: confirm builds Brainbase meeting_note_summary with source_transcripts and no provider note body adoption.
  - AC-006: note-only provider artifacts produce zero Meeting Pack candidates.
  - AC-007: preview exposes note-only exclusion reason without returning full transcript text.
  - AC-008: existing cursor advancement and dedupe behavior remains stable.
- `tests/e2e/story-meeting-source-mcp-sync-worker-contract.spec.ts`
  - AC-003 AC-004 AC-005: settings resync confirm submits Brainbase-owned meeting note source materials to review-ingest.
- `tests/e2e/story-meeting-source-brainbase-note-generation-contract.spec.ts`
  - AC-001 AC-002 AC-003 AC-004 AC-005 AC-006 AC-007 AC-009 S-001 S-002: provider-generated notes are not submitted as Brainbase minutes, transcript sources remain available for Brainbase generation, and cursor/dedupe behavior stays stable.
  - AC-008 AC-010 S-003: provider note-only artifacts are excluded from Meeting Pack candidates with visible exclusion reasons.

## Non-goals

- This story does not implement a new external LLM provider.
- This story does not move Graph SSOT / People SSOT resolution into the source sync worker.
- This story does not change Mac Companion markdown rendering.
