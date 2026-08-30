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

## Decision

Add `brainbase_knowledge_event_record` to the private MCP server as a strict authenticated adapter.

The adapter:

1. validates the complete `knowledge_event.v1` structure;
2. rejects authority expansion, personal visibility, Graph promotion, and external action;
3. recalculates canonical payload and event digests;
4. binds the source repository, Story, Git HEAD, subject, source pointer, and computed verification evidence;
5. resolves the event project through the existing project-auth endpoint;
6. sends the unchanged validated event to `POST /api/knowledge/events`;
7. accepts the response only when the candidate is active and retrievable and no Graph entity was created;
8. returns a bounded MCP receipt with canonical references.

The adapter is annotated as a write tool. Existing confirmation, project authorization, service-token handling, API idempotency, and audit behavior remain authoritative.

## Runtime flow

```text
Brainbase Judgment + routed project knowledge
  -> VibePro context binding
  -> implementation
  -> exact-state computed verification
  -> knowledge_event.v1
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
- Replays inherit the backend event registry's idempotency.
- MCP rejects producer-side tampering before any network mutation.
- Canonical promotion remains a distinct reviewed decision.

## Rejected alternatives

- Persist event files inside the MCP process: rejected because the organization runtime already owns durable storage and authorization.
- Create a VibePro-specific database table: rejected as duplicate event infrastructure.
- Promote `development_learning` directly to Graph: rejected because evidence capture is not canonical authority.
- Trust the submitted hash or backend response without recomputation and boundary checks: rejected because either side could drift silently.
