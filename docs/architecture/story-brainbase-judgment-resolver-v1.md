---
story_id: story-brainbase-judgment-resolver-v1
title: Brainbase judgment episode lifecycle
status: accepted
updated_at: 2026-08-11
---

# Story: Brainbase judgment episode lifecycle

## Problem

Judgment Resolver originally existed as a model-callable MCP tool. A later design moved both canonical context and semantic classification into `UserPromptSubmit`; that made a keyword classifier decide whether Brainbase was needed before the model could understand the request. The corrected boundary keeps canonical input in the Host, restores model-callable `brainbase_resolve_turn`, and records all subsequent Brainbase evidence in the judgment journal.

The first issue was a trust-boundary defect. The remaining issue is a lifecycle defect: an initial routing judgment cannot prove which Brainbase sources were actually selected, searched, retrieved, or written during an iterative tool loop.

## Purpose-derived design

The purpose is to apply Brainbase judgment to every answer and make actual knowledge use auditable without constraining the model's useful investigation loop. From that purpose:

1. Judgment begins before the model chooses how to answer.
2. The Host owns canonical `conversation_context`; Resolver deterministically classifies that context and selects the initial route from the runtime manifest.
3. One turn is one judgment episode, not one Resolver attempt and not one Brainbase call.
4. The model cannot call Judgment Resolver, but may call Brainbase knowledge/retrieval tools 0..N times as results create new questions.
5. `PostToolUse` records actual Brainbase outcomes in an atomic journal-commit order; `Stop` shares that transition boundary and finalizes one episode receipt.
6. Required knowledge gets one continuation opportunity; if it is still missing, the active Stop fails explicitly without fabricating a final receipt.
7. Judgment evidence constrains reasoning but is not action authorization.

## Architecture

```text
UserPromptSubmit
  -> canonical transcript/context
  -> loopback signed Resolver bridge
  -> immutable initial route + judgment episode
  -> model generation with selected active DAG

model/tool loop (0..N)
  -> any tool call
  -> PostToolUse
  -> immutable safe execution event
  -> Brainbase calls additionally get an accurate owner trace

Stop
  -> required-capability check
  -> complete final receipt
     or one continuation -> explicit failure with no final receipt
```

The model-visible MCP catalog has no Judgment Resolver tool. The persistent runtime remains the trusted signing bridge because it owns the API token, binding secret, and adapter identity. Model-visible Brainbase knowledge tools remain available for iterative use.

## Runtime responsibility split

| Component | Current responsibility | Model use |
| --- | --- | --- |
| Codex lifecycle Host adapter | Preserve canonical conversation context, call the loopback bridge, verify the returned receipt binding, own episode/event/finalization lifecycle, and publish audit lines. It neither holds the Resolver signing secret nor semantically reclassifies after episode creation. | No internal LLM |
| Persistent Brainbase Host bridge | Hold the API token, its copy of the shared `BRAINBASE_JUDGMENT_BINDING_SECRET`, and adapter identity outside model context; bind and sign the Resolver API request. | No internal LLM; transports the model-callable request |
| Resolver API/server | Hold the verifier copy of the same shared `BRAINBASE_JUDGMENT_BINDING_SECRET`, then verify the bridge signature and binding before passing canonical input to the Judgment Resolver service. | No internal LLM |
| Judgment Resolver service | Reconcile model interpretation with canonical input and manifest-owned policy, inherit bounded context for under-specified follow-ups, apply monotonic keyword safety rails and select the active DAG. | No LLM provider; does not own natural-language understanding |
| Codex model | Decide how to answer inside the returned active DAG, formulate and refine queries from observed evidence, and call Brainbase knowledge/retrieval tools 0..N times. It cannot author or replace the initial classification. | The open-ended LLM in the current execution loop |
| Knowledge Resolver | Deterministically select the canonical source route and required retrieval capability. It does not search or retrieve content. | No internal LLM |
| Tool adapters | Perform file, shell, Graph, Personal KG, repo, Drive, wiki, and other operations. Every completed call produces a non-visible execution event; direct `mcp__brainbase__*` outcomes additionally produce owner-visible Brainbase audit lines. | Called by the Codex model |

In the current implementation, `semantic_matchers` is a deterministic safety rail, not semantic understanding. A match may add obligations, action floors, risks, domains, or signals. An unmatched rule cannot remove model-derived requirements or force `general/answer`. A missing model interpretation, a follow-up with no resolvable referent, or a knowledge route without required project context uses the clarification DAG.

## Decision

The accepted v1 runtime keeps initial classification deterministic and manifest-backed. The Codex lifecycle Host adapter supplies canonical context and owns the episode lifecycle, the persistent Brainbase Host bridge owns the signer copy of the shared secret and signs the API request, the Resolver API/server owns the verifier copy and verifies that signature, Judgment Resolver selects the bounded initial route, and the Codex model performs open-ended reasoning plus iterative Brainbase query refinement inside that route. Claude Code is a future Host-adapter candidate—specifically a lifecycle adapter—for the same responsibility split, but it is not part of the current episode-lifecycle hook integration and would not receive either copy of the shared secret.

This division is intentional: the Codex model understands language, Brainbase owns policy and evidence, MCP transports the request, and Hooks enforce the lifecycle. Resolver has no hidden model provider; it validates the explicit `model_interpretation` supplied through `brainbase_resolve_turn`.

Introducing model-assisted initial classification later would require a new Architecture and Spec decision covering provider ownership, context and prompt boundaries, latency and failure semantics, observability, cost, and how model output is constrained before it can select an active DAG.

## Evidence semantics

- Initial route: how the turn should be judged and which DAG/capabilities apply.
- Tool event: what the model actually called and what kind of result occurred.
- Final receipt: whether the observed event set satisfied the episode contract.

`brainbase_knowledge_resolve` chooses the reference destination. It does not search or retrieve content, so its owner trace says `📚 Brainbase参照先:`. Only a successful exact route call satisfies required `knowledge.resolve`. A generic Brainbase call cannot be counted merely to make the final receipt look complete.

Raw tool inputs, raw responses, secrets, full answer text, absolute paths, and raw session IDs are excluded. Safe bounded projections and digests preserve auditability without turning the journal into a second data store.

## Boundaries

- Project binding is judgment context, not authorization. Inaccessible project policy is omitted without rejecting general judgment.
- Managed clarification is a valid initial route and proceeds to model generation.
- Binding/context/route integrity failure blocks completion.
- Concurrent `PostToolUse` processes are totally ordered by the Host's atomic journal commit, not by an unverifiable wall-clock call-start time. Episode start, event commit, and Stop finalization share one per-turn SQLite `BEGIN IMMEDIATE` transaction boundary, so no committed event can be inserted into an already finalized episode. The OS releases the transaction lock when a process exits; the Host never guesses whether a stale lock file is safe to delete.
- The Host uses Node's built-in SQLite when the runtime provides it, avoiding native-addon CPU/ABI coupling between Codex and the interactive shell. Node 20 runtimes fall back to the locally installed `better-sqlite3` build.
- Missing required capability, autonomy, continuation, or business-body evidence returns `decision:block` on the first repairable Stop; no incomplete final receipt is written. The model-authored answer is not rejected merely because it omits the Host-owned audit surface. If the active repeated Stop is still incomplete, it converges to a finalized `audit_degraded` receipt instead of regenerating forever or exiting with `judgment_stop_repair_exhausted`. Body preservation strips only the leading Host audit namespace block, including malformed variants, while keeping audit-like text after the business body starts. A true orphan Stop emits one visible degraded-warning repair, then converges to an immutable non-final `audit_degraded` receipt without asking for a new task; replay cannot reopen the repair loop. Identity or integrity ambiguity and transaction-acquisition timeout remain terminal fail-closed failures.
- Runtime 2.3 implement/operate episodes use a hidden structured Stop state rather than prose matching. `pending` blocks, `waiting_human` must match an allowed reason and visible marker, and `completed` requires a successful same-episode execution event. The event proves execution, not semantic correctness; content verification remains a separate test/readback responsibility. Runtime 2.2 and older episodes retain prose matching only for compatibility.
- Normal platform permissions, approvals, and executor authorization remain responsible for effects. There is no Effect Guard.

## Acceptance criteria

1. Every `UserPromptSubmit` opens or reuses one unresolved judgment episode and saves canonical turn input.
2. Every model turn calls `brainbase_resolve_turn` before other work, with the saved input unchanged and an explicit model interpretation.
2. Judgment Resolver is absent from model-visible MCP tools.
3. Canonical context preserves ordered exact user/assistant text and current request exactly once.
4. Resolver owns deterministic manifest-backed classification, policy, required capabilities, and active-DAG selection, with no LLM provider/API dependency.
5. The model may execute 0..N tool calls after the initial route; Brainbase calls alone produce owner-visible Brainbase lines.
6. Every matching `PostToolUse` creates at most one immutable event per `tool_use_id`.
7. A replayed identical event is a no-op; a conflicting event fails loudly.
8. Journals and visible traces exclude raw payloads/secrets and accurately distinguish route, search, retrieval, and write.
9. Only a successful exact knowledge-route event satisfies required `knowledge.resolve`.
10. `Stop` creates one immutable complete final receipt only after required capability, autonomy, continuation, and business-body evidence pass, then returns the journal-derived owner audit/value surface once as `systemMessage`.
11. Missing required evidence triggers one continuation; an incomplete active retry converges to `audit_degraded` and never creates an infinite Stop loop.
12. Zero Brainbase calls is valid when the selected judgment requires none.
13. Open episodes do not become prior accepted receipts; legacy incomplete journals remain readable but are never newly created.
14. Project scope absence does not reject judgment itself.
15. Judgment receipts never authorize writes/external actions or introduce duplicate authorization.
16. `CLAUDE.md`, `AGENTS.md`, Skill, capability, runbook, spec, and tests publish this same contract.
17. The current Codex model remains responsible for open-ended query formulation and iterative investigation inside the selected DAG; Host and Resolver do not silently perform that model work. Claude Code support requires a separate Host adapter and lifecycle integration.
18. Runtime 2.3 implement/operate completion is accepted only from one valid structured Stop state plus successful same-episode execution evidence; answer wording is not the primary completion signal.

## Deployment boundary

A merged code change is not proof that lifecycle Hooks are active. Static definitions and a stored trust section prove only installation. `scripts/check-codex-judgment-hook-readiness.mjs` queries the current Codex Host `hooks/list`; only three enabled, matcher-correct, currently trusted Hooks yield `ready_for_fresh_task`. A modified or untrusted Hook yields `trust_required`, and only the owner may approve it through `/hooks`; repository code never writes `trusted_hash`. Verification reaches `proven_active` only with a task created after that approval, at least one actual Brainbase tool call, an event sidecar, a complete final receipt with `owner_audit_source=stop_hook_system_message`, and a readback proving that the complete Host-rendered audit/value `systemMessage` appeared once in the owner UI or event stream in journal-commit order. The Codex JSONL transcript remains correlation and model-answer evidence, not a stable serialization contract for Hook `systemMessage`. The final receipt `answer_digest` binds the exact model-authored `last_assistant_message`; the model body must not duplicate the Host audit surface.
