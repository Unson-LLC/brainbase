# Story: Brainbase judgment episode lifecycle

## Problem

Judgment Resolver originally existed as a model-callable MCP tool. Later, `UserPromptSubmit` correctly moved classification and canonical context into the Host before model generation, but it also treated that initial route receipt as the whole turn's final evidence. Brainbase tool use after the model started was invisible to the judgment journal, and the design implicitly encouraged one fixed lookup per turn.

The first issue was a trust-boundary defect. The remaining issue is a lifecycle defect: an initial routing judgment cannot prove which Brainbase sources were actually selected, searched, retrieved, or written during an iterative tool loop.

## Purpose-derived design

The purpose is to apply Brainbase judgment to every answer and make actual knowledge use auditable without constraining the model's useful investigation loop. From that purpose:

1. Judgment begins before the model chooses how to answer.
2. The Host owns canonical `conversation_context`; Resolver owns classification and relevant-context selection.
3. One turn is one judgment episode, not one Resolver attempt and not one Brainbase call.
4. The model cannot call Judgment Resolver, but may call Brainbase knowledge/retrieval tools 0..N times as results create new questions.
5. `PostToolUse` records actual Brainbase outcomes; `Stop` finalizes one episode receipt.
6. Required knowledge gets one continuation opportunity, then incomplete evidence instead of an infinite loop.
7. Judgment evidence constrains reasoning but is not action authorization.

## Architecture

```text
UserPromptSubmit
  -> canonical transcript/context
  -> loopback signed Resolver bridge
  -> immutable initial route + judgment episode
  -> model generation with selected active DAG

model/tool loop (0..N)
  -> mcp__brainbase__* call
  -> PostToolUse
  -> immutable safe event + accurate owner trace

Stop
  -> required-capability check
  -> complete final receipt
     or one continuation -> incomplete final receipt
```

The model-visible MCP catalog has no Judgment Resolver tool. The persistent runtime remains the trusted signing bridge because it owns the API token, binding secret, and adapter identity. Model-visible Brainbase knowledge tools remain available for iterative use.

## Evidence semantics

- Initial route: how the turn should be judged and which DAG/capabilities apply.
- Tool event: what the model actually called and what kind of result occurred.
- Final receipt: whether the observed event set satisfied the episode contract.

`brainbase_knowledge_resolve` chooses the reference destination. It does not search or retrieve content, so its owner trace says `📚 Brainbase参照先:`. Only a successful exact route call satisfies required `knowledge.resolve`. A generic Brainbase call cannot be counted merely to make the final receipt look complete.

Raw tool inputs, raw responses, secrets, full answer text, absolute paths, and raw session IDs are excluded. Safe bounded projections and digests preserve auditability without turning the journal into a second data store.

## Boundaries

- Project binding is judgment context, not authorization. Inaccessible project policy is omitted without rejecting general judgment.
- Managed clarification is a valid initial route and proceeds to model generation.
- Binding/context/route integrity failure blocks before model generation.
- A missing required route blocks only the first Stop. The second Stop finalizes incomplete and terminates normally.
- Normal platform permissions, approvals, and executor authorization remain responsible for effects. There is no Effect Guard.

## Acceptance criteria

1. Every `UserPromptSubmit` opens or reuses one judgment episode before model generation.
2. Judgment Resolver is absent from model-visible MCP tools.
3. Canonical context preserves ordered exact user/assistant text and current request exactly once.
4. Resolver owns classification, policy, required capabilities, and active-DAG selection.
5. The model may execute 0..N Brainbase tool calls after the initial route.
6. Every matching `PostToolUse` creates at most one immutable event per `tool_use_id`.
7. A replayed identical event is a no-op; a conflicting event fails loudly.
8. Journals and visible traces exclude raw payloads/secrets and accurately distinguish route, search, retrieval, and write.
9. Only a successful exact knowledge-route event satisfies required `knowledge.resolve`.
10. `Stop` creates exactly one immutable complete or incomplete final receipt.
11. Missing required knowledge triggers one continuation and never an infinite Stop loop.
12. Zero Brainbase calls is valid when the selected judgment requires none.
13. Open and incomplete episodes do not become prior accepted receipts; legacy journals remain readable.
14. Project scope absence does not reject judgment itself.
15. Judgment receipts never authorize writes/external actions or introduce duplicate authorization.
16. `CLAUDE.md`, `AGENTS.md`, Skill, capability, runbook, spec, and tests publish this same contract.

## Deployment boundary

A merged code change is not proof that lifecycle Hooks are active. Activation requires the canonical deployed checkout plus user-level `UserPromptSubmit`, `PostToolUse`, and `Stop` definitions. Verification needs a fresh turn, at least one actual Brainbase tool call, an event sidecar, a final receipt, and an owner-visible line whose wording matches the real operation.
