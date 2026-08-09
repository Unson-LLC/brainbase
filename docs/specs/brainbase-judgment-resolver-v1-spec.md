# Brainbase Judgment Resolver Host pre-turn specification

## 1. Invariant

Every managed Codex turn has exactly one accepted Judgment receipt before model generation. A turn may have up to three transient transport attempts before adoption. It has no Resolver call after adoption and no model-initiated Resolver call.

## 2. Host event

The global `UserPromptSubmit` wrapper receives:

- `session_id`
- `turn_id`
- `prompt`
- nullable `transcript_path`
- `cwd`
- `model`
- `permission_mode`

`session_id`, `turn_id`, and non-empty `prompt` are mandatory. An absent, unreadable, outside-root, non-regular, malformed, or session-mismatched transcript produces a partial context; it never causes the Host to invent history.

## 3. Resolver input

The exact public body is:

```json
{
  "request": "それでいい。修正して",
  "turn_id": "turn-2",
  "project_code": "brainbase",
  "conversation_context": {
    "schema_version": "brainbase-conversation-context-v1",
    "session_ref": "sha256-of-session-id",
    "messages": [
      {"sequence": 0, "turn_id": "turn-1", "role": "user", "phase": null, "text": "文脈は入る？"},
      {"sequence": 1, "turn_id": "turn-1", "role": "assistant", "phase": "final", "text": "生の会話履歴を渡します。"},
      {"sequence": 2, "turn_id": "turn-2", "role": "user", "phase": null, "text": "それでいい。修正して"}
    ],
    "prior_receipts": [],
    "runtime": {
      "host": "codex",
      "model": "gpt-5",
      "permission_mode": "workspace-write",
      "project_binding": "brainbase"
    },
    "instruction_bindings": [
      {"scope": "repository", "source_ref": "AGENTS.md", "digest": "sha256-of-file"}
    ],
    "completeness": "complete",
    "source_digest": "sha256-of-context-without-source-digest"
  }
}
```

Unknown top-level or nested fields are rejected. The current turn appears exactly once and is the final user message with text exactly equal to `request`. `project_code`, when present, equals `runtime.project_binding`.

The Host includes raw ordered user/assistant message text. It excludes injected host envelopes, developer messages, compaction summaries, reasoning, function/tool calls, tool arguments, and tool output. It sends a hashed session reference and repo-relative instruction references, never personal absolute paths.

## 4. Canonical JSON and digests

`brainbase-canonical-json-v1` recursively sorts object keys by Unicode code point, preserves array order, serializes JSON primitives with standard JSON representation, and rejects non-finite numbers and undefined.

- `source_digest`: SHA-256 of canonical context without its `source_digest`
- `context_digest`: SHA-256 of the exact canonical `conversation_context`
- `request_digest`: SHA-256 of the exact canonical Resolver body
- `plan_digest`: SHA-256 of the normalized receipt plan without volatile receipt identity/time and digest fields

All digests are lowercase 64-character hexadecimal strings.

## 5. Server-owned classification

The runtime manifest owns intent, domain, signal, safety, and follow-up matchers. Resolver determines classification; there is no caller-supplied classification field.

1. Detect explicit intent/domain/signal/effect in the current request.
2. For implement/operate and write/external effects, match requested effect rather than conditional, quoted, negated, or merely mentioned verbs.
3. If the request is a follow-up and lacks a domain, inherit from the latest prior accepted receipt; otherwise inspect the latest prior raw user message with a supported domain matcher.
4. Current explicit evidence overrides inherited values. Current request always determines the minimum action/risk floor.
5. With no resolvable referent, return managed `needs_classification` and the clarification DAG.
6. General answer is the safe fallback only for self-contained requests, not unresolved follow-up references.

## 6. DAG and policy resolution

Domain and signal selectors map classification to manifest DAGs. High/critical risk, write/external effect, or authority signal adds the authority DAG. Conditional composition edges apply only when both endpoints are active. All incoming edges are conjunctive dependencies; nodes use stable topological order.

Policy visibility uses authenticated access only:

- global: always
- organization: matching tenant
- project: project code is in authenticated project scope
- owner: matching person

Project binding is judgment context, not action authority. An out-of-scope `project_code` does not reject judgment. It only makes that project's policies inapplicable. Personal owner-only policy remains protected by its existing access rules.

## 7. Receipt

Receipt fields are:

- identity/provenance: `resolution_id`, `resolved_at`, `turn_id`, `request_digest`, `context_digest`, `runtime_version`, `manifest_digest`, `plan_digest`, `host_binding`, `project_code`
- result: `status`, `classification`, `classification_evidence`, `classification_assurance`, `reconciliation_reasons`
- plan: `selected_dag_ids`, `applicable_policies`, `suppressed_policies`, `required_capabilities`, `active_nodes`, `active_edges`, `active_node_definitions`, `unresolved`, `rationale`

`active_node_definitions` is one-to-one and in the same order as `active_nodes`. `status=resolved` requires a classification and no unresolved entries. `status=needs_classification` requires a null classification, unknown assurance, `unresolved=["classification"]`, and a clarification graph.

## 8. Transport and Host bridge

The persistent Brainbase MCP runtime exposes loopback-only `POST /host/judgment/resolve`. This endpoint is not an MCP tool. It authenticates the configured runtime, signs the exact request with the registered adapter binding, calls `POST /api/judgment/resolve`, validates the full receipt shape/digests/DAG, and normalizes the result to `managed|unmanaged`.

Signing uses HMAC-SHA256 over canonical:

```text
["brainbase-judgment-binding-v1", adapter_id, adapter_version, turn_id, issued_at, request_digest]
```

The API verifies registered adapter/version, request digest, UTC millisecond timestamp window, and constant-time signature comparison. Secrets never enter Host hook output or model context.

API error codes remain specific. In particular, invalid canonical context stays `judgment_resolution_input_invalid` rather than becoming a generic API error.

## 9. Receipt adoption

The journal path is derived from hashed session and hashed turn IDs. Files and directories use owner-only permissions. Adoption writes a unique temporary file and hard-links it to the final target, so concurrent attempts cannot overwrite the first accepted receipt.

Before returning an existing entry, Host re-verifies request text digest, turn binding, request digest, context digest, managed binding, and active definitions. A conflicting same-turn request fails closed.

## 10. Model and action boundaries

On success, the hook passes the accepted receipt to model context and instructs the model not to call or reclassify Resolver. Managed clarification still begins model generation.

Judgment does not grant effects. Platform permissions, explicit approval, and executor authorization remain unchanged. The Host contract contains no separate action-kind gate and does not turn a write/external classification into permission.

## 11. Failure behavior

- transient: timeout, connection reset/refusal, or recognized 429/502/503/504 before adoption; bounded retry
- terminal: invalid hook input, untrusted context source, 4xx validation/binding rejection, malformed response, digest mismatch, unmanaged binding, missing active definitions, or same-turn conflict
- after adoption: never retry or re-resolve; return the verified journaled receipt

Terminal Host failure returns `continue=false`, so no unjudged model response is generated.

## 12. Verification matrix

- service: strict schema/digests, server-owned classification, action floors, follow-up inheritance, clarification, policy scope, DAG topology, manifest lock
- API: signing, timestamp boundaries, exact request binding, error mapping, out-of-scope project behavior
- internal runtime: Resolver absent from model tools, signed pre-model dispatch, full receipt validation
- Host: raw transcript extraction, structural exclusion, privacy, exact current message, retry/adoption/reuse/conflict
- end-to-end: Host dispatch -> authenticated API -> receipt -> active DAG model boundary, including follow-up, clarification, write classification, and inaccessible project policy
- publication: `CLAUDE.md`/`AGENTS.md` identity and consistent Skill/capability/runbook contract
