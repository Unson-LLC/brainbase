---
story_id: story-vibepro-knowledge-event-record
status: accepted
date: 2026-08-31
owners:
  - brainbase-maintainers
supersedes: []
---

# ADR: Reuse the authenticated Knowledge Event pipeline for VibePro learning

## Context

VibePro can bind a managed Brainbase Judgment receipt and the matching project knowledge routes, then generate a development-learning event after exact-Git-state verification. The private Brainbase runtime already owns the durable Knowledge Event registry and candidate lifecycle through `POST /api/knowledge/events`.

Creating another persistence path in MCP would duplicate idempotency, organization scope, indexing, and promotion policy. Sending the event directly to Graph would also collapse evidence capture and canonical promotion into one producer-controlled action.

The trust boundary is explicit: VibePro is responsible for deriving the event from its local computed verification. The MCP independently validates the submitted envelope's structure, digests, source bindings, project scope, and non-promotion authority, but it does not replay the local verification command or treat the candidate as canonical truth.

## Decision

Add `brainbase_knowledge_event_record` to the private MCP server as a strict authenticated adapter, published through the existing Knowledge tool family.

The adapter:

1. validates the complete `knowledge_event.v1` structure;
2. rejects authority expansion, personal visibility, Graph promotion, and external action;
3. recalculates canonical payload and event digests;
4. binds the submitted source repository, Story, Git HEAD, subject, source pointer, and verification summary into one internally consistent envelope;
5. authenticates the exact project against the current token scope and forwards the token-bound organization context for service-token calls;
6. sends the unchanged validated event to `POST /api/knowledge/events`;
7. accepts the response only when the candidate is active and retrievable and no Graph entity was created;
8. returns a bounded MCP receipt with canonical references.

The adapter is annotated as a non-destructive, idempotent write tool. Existing project authorization, service-token verification, API idempotency, and audit behavior remain authoritative.

## Runtime flow

```text
Brainbase Judgment + routed project knowledge
  -> VibePro context binding
  -> implementation
  -> exact-state computed verification
  -> candidate-only knowledge_event.v1
  -> brainbase_knowledge_event_record
  -> authenticated POST /api/knowledge/events
  -> idempotent event registry
  -> active, retrievable Knowledge Candidate
  -> later review and promotion decision
```

The final arrow is intentionally outside this Story. The MCP cannot promote the candidate and fails if the API reports a `graph_entity_id`.

## Consequences

- VibePro learning enters the organization knowledge loop without a new database or direct Graph writer.
- Project scope and credentials remain centralized in the existing authenticated API layer.
- Replays inherit the backend event registry's idempotency and are advertised as idempotent to MCP clients.
- Malformed, internally inconsistent, out-of-scope, or authority-expanding envelopes are rejected before API mutation.
- An authenticated producer could still submit a false but internally consistent candidate; candidate-only storage and later review are therefore mandatory safety boundaries.
- Canonical promotion remains a distinct reviewed decision.

## Rejected alternatives

- Persist event files inside the MCP process: rejected because the organization runtime already owns durable storage and authorization.
- Create a VibePro-specific database table: rejected as duplicate event infrastructure.
- Promote `development_learning` directly to Graph: rejected because evidence capture is not canonical authority.
- Treat the submitted event as proof that verification actually ran: rejected because the MCP cannot replay VibePro's local execution environment; it validates the envelope and preserves it as a candidate instead.
