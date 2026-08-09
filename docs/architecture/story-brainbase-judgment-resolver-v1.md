# Story: Brainbase Judgment Resolver Host pre-turn

## Problem

Judgment Resolver existed as a model-callable MCP tool. The global hook only told the model to call it, while the model also had to invent a classification and a small prose summary of prior context. Therefore judgment happened after model generation had started, malformed calls could stop the turn, context could be lost, and project access was confused with the ability to judge.

This was a trust-boundary defect, not a service outage or a response-speed problem.

## Purpose-derived design

The purpose is to apply Brainbase judgment to every answer and action consistently across model hosts. From that purpose:

1. Judgment must happen before the model chooses how to answer.
2. The Host, which owns the session and turn, must supply canonical context.
3. Resolver, not the model, must own classification and relevant-context selection.
4. The stable invariant is one accepted receipt per turn; transport attempts are implementation detail.
5. A judgment receipt constrains reasoning but is not action authority.

## Architecture

```text
Codex UserPromptSubmit
  -> Host transcript reader and canonical context builder
  -> loopback Host bridge in persistent Brainbase MCP runtime
  -> signed Judgment API
  -> request/context-bound receipt
  -> atomic per-turn adoption journal
  -> model generation with only the selected active DAG
```

The model-visible MCP catalog has no Judgment Resolver tool. The persistent runtime is reused as the trusted signing bridge because it already owns the API token, binding secret, and adapter identity. The bridge is bound to loopback and performs no write or external action.

## Canonical context

The Host preserves ordered raw user/assistant message text in canonical `conversation_context` and structurally excludes developer envelopes, summaries, reasoning, tool calls, and tool output. It adds the exact current request once, prior accepted receipt projections, hashed session reference, runtime/project binding, repo-relative instruction binding digests, completeness, and a source digest.

The Host does not summarize or semantically choose history. Resolver decides what is relevant. Short follow-ups can inherit classification from a prior accepted receipt or prior raw user message.

## Boundaries

- `project_code` identifies the judgment context. It does not authorize an action and does not require that project policy be visible. Policies remain filtered by authenticated scope.
- A managed clarification receipt is a valid judgment result and proceeds to model generation.
- Binding, context, or receipt integrity failure blocks model generation.
- Normal platform permissions, explicit approvals, and executor authorization remain responsible for effects. Host and model do not re-judge the receipt through a second guard.

## Acceptance criteria

1. Every Codex `UserPromptSubmit` invokes Host resolution before model generation.
2. Judgment Resolver is absent from model-visible MCP tools.
3. Public Resolver input contains current request, turn ID, optional project code, and required canonical conversation context only.
4. Context preserves ordered exact user/assistant text and current request exactly once for the current turn.
5. Raw session ID, transcript absolute path, developer instructions, reasoning, and tool payloads are not sent to Resolver.
6. Resolver owns intent, domain, signal, action, risk, confidence, policy, and active-DAG selection.
7. Explicit current request evidence determines current action/risk floors; follow-ups can inherit prior domain context.
8. One valid receipt is atomically adopted per turn and reused on repeated Host entry.
9. Only transient transport/API failures retry, only before receipt adoption, and only within a bounded count.
10. Request, context, turn, binding, and active-node definitions are verified before adoption.
11. Managed clarification and policy-resolution receipts reach the model; unavailable or invalid Host resolution does not.
12. Project scope absence omits inaccessible project policies without rejecting judgment itself.
13. API validation codes remain distinguishable through the internal bridge.
14. `CLAUDE.md`, `AGENTS.md`, Skill, capability, runbook, and tests publish the same Host pre-turn contract.
15. Judgment receipt is never treated as write/external authorization, and no Judgment-specific duplicate authorization feature is introduced.

## Deployment boundary

A merged code change is not proof that the global hook or persistent runtime is active. Activation requires the canonical deployed checkout, user-level hook path, persistent loopback runtime, API compatibility, signed preflight, and running commit to be verified separately.
