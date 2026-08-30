---
story_id: story-vibepro-knowledge-event-record
status: accepted
date: 2026-08-31
owners:
  - brainbase-maintainers
supersedes: []
---

# ADR: VibePro learning enters Brainbase as an append-only candidate

## Context

VibePro can bind a Brainbase Judgment receipt and project knowledge references to a Story, then produce a development learning only after computed verification passes for the same Git state. Brainbase needs to receive that learning without allowing the producer to grant itself canonical authority.

A Knowledge Event is evidence that something was observed. It is not, by itself, permission to change Graph, Personal KG, or an external system. Treating the event as a direct canonical mutation would collapse observation, review, and promotion into one unauditable operation.

## Decision

Brainbase exposes one MCP command, `brainbase_knowledge_event_record`, for the `knowledge_event.v1` envelope emitted by VibePro.

The receiver performs the following sequence before publishing any local record:

1. validate the complete strict schema;
2. reject authority expansion, personal visibility, external action, and Graph-promotion permission;
3. recalculate the canonical payload SHA-256;
4. recalculate the deterministic event ID;
5. bind `source.ref`, Story ID, Git HEAD, subject ID, source pointer, and verification evidence;
6. reject duplicate evidence labels and any evidence source that is not computed;
7. reject sensitive summary material;
8. publish a candidate record with create-only semantics.

Records are stored under:

```text
<BRAINBASE_PERSONAL_OS_DIR>/runtime/knowledge-events/v1/<event_id>.json
```

The filename comes only from the validated `kev_<sha256>` event ID. The writer serializes a complete temporary file and installs it through an atomic hard link. The target is never overwritten.

An identical retry returns `already_recorded` using the original receipt time. If an existing target is malformed or differs from the submitted event, the operation fails closed. The MCP receipt returns a `brainbase://` reference rather than the local filesystem path.

## Authority boundary

```text
VibePro computed verification
  -> knowledge_event.v1
  -> Brainbase candidate store
  -> later review / promotion flow
  -> canonical Graph or team knowledge
```

This Story implements only the first two arrows. It does not implement the later review or promotion operation.

The stored record states:

- `candidate_only=true`
- `graph_promoted=false`
- `external_action_executed=false`

The implementation does not load or mutate `graph.json` while recording.

## Consequences

- Verified implementation learning can survive outside an ephemeral VibePro workspace.
- Producer-side tampering and replay conflicts are visible and rejected.
- Repeated delivery is safe and idempotent.
- Brainbase preserves the distinction between evidence capture and canonical judgment.
- The local OSS runtime remains single-owner and non-hosted; multi-tenant authorization and organizational promotion remain outside this slice.

## Rejected alternatives

- Directly write VibePro summaries into Graph: rejected because it lets the producer self-promote knowledge.
- Trust only the submitted `body_hash`: rejected because it would not detect a rewritten payload.
- Overwrite the file on retry: rejected because it destroys the first recorded audit fact.
- Return the local storage path: rejected because MCP responses should expose canonical references, not machine-specific paths.
