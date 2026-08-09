# Judgment episode runbook

Judgment Resolver is a Host lifecycle boundary. Every Codex turn opens one judgment episode because choosing how to answer is itself a judgment. The model does not call Resolver and does not author classification or `conversation_context`.

## Turn flow

1. `UserPromptSubmit` sends the turn to `scripts/codex-hooks/judgment-resolver-entry.sh`.
2. The Host validates the hook payload, reads the canonical JSONL transcript, and performs structural filtering. It preserves ordered raw user/assistant text while excluding envelopes, summaries, reasoning, tool arguments, and tool output.
3. Before model generation, the Host builds canonical `conversation_context`, calls loopback `POST /host/judgment/resolve`, verifies the response, and atomically opens one episode with its initial route receipt.
4. The model follows only the returned active DAG. It may call Brainbase knowledge/retrieval tools 0..N times, using each result to decide the next lookup. It never calls or reclassifies Judgment Resolver.
5. Every completed `mcp__brainbase__*` call triggers `PostToolUse`. The Host stores one immutable safe event and displays an accurate short line. `brainbase_knowledge_resolve` selects a reference destination; it is not itself a search or retrieval.
6. `Stop` validates the event set and atomically creates one final episode receipt. If required `knowledge.resolve` is missing, the first Stop asks the model to continue. A repeated Stop with `stop_hook_active=true` finalizes the episode as incomplete so the hook cannot loop forever.

## Canonical conversation context

`conversation_context` uses schema `brainbase-conversation-context-v1` and contains:

- hashed `session_ref`; no raw session ID or absolute transcript path
- ordered user/assistant messages with turn identity and exact text
- projections of prior complete finalized episodes
- runtime host, model, permission mode, and project binding
- repo-relative instruction bindings with content digests
- completeness marker and canonical `source_digest`

The Host does not summarize history or guess semantic relevance. Resolver owns classification and relevance selection. Project binding is judgment context, not action authority; inaccessible project policy is omitted without making general judgment unavailable.

## Episode journal

For each hashed session/turn, the Host maintains owner-only append-only files:

```text
<turn>.episode.json
<turn>.events/<sha256(tool_use_id)>.json
<turn>.continuation.json
<turn>.final.json
```

- `episode.json` binds the turn to its canonical request/context and initial route.
- Every event stores tool identity, outcome, bounded safe projection, and digests; raw arguments, raw responses, secrets, absolute paths, and unbounded text are not saved.
- `continuation.json` proves that one required-capability continuation was requested.
- `final.json` binds the immutable event-set digest and records `complete` or `incomplete`.

Initial route and final episode receipt are different facts. The initial route says what should guide the turn. The final receipt says what actually happened before Stop. Only complete finalized episodes become prior-receipt context; legacy v1/v2 adoption journals remain readable.

## Owner-visible traces

The first user-facing message uses the stored initial judgment line once:

```text
🧠 判断参照: 直前の「ログイン後の白画面」を参照 → 実装依頼として継続 ✓
```

Each actual Brainbase call gets its own `PostToolUse` trace. The wording must match the operation:

```text
📚 Brainbase参照先: 「監査方法」→ owning_repoのdocs/を選択 ✓
📚 Brainbase検索: 「Judgment Resolver」→ Graphを検索 ✓
📚 Brainbase取得: decision:abc123を取得 ✓
```

Never show `検索` or `取得` for `brainbase_knowledge_resolve`; it only selects a route. A failed or unconfirmed call uses a warning form and cannot satisfy a required capability.

## Completion invariant

The invariant is exactly one episode and one final receipt per turn, not one Resolver network attempt and not one Brainbase tool call. Before episode creation, recognized transient failures may be retried within the Host limit. After creation, the same turn reuses the initial route. Tool calls may occur 0..N times. Replayed `PostToolUse` and `Stop` events reuse their immutable records.

If `required_capabilities` contains `knowledge.resolve`, only a successful exact `mcp__brainbase__brainbase_knowledge_resolve` event with resolved/unconfirmed status satisfies it. Search, Graph reads, Personal KG reads, unrelated Brainbase calls, and failed route calls do not substitute for the routing decision.

## Authorization boundary

Initial and final receipts constrain reasoning and provide audit evidence. They do not authorize writes or external effects. Existing platform permissions, explicit approvals, and executor authorization remain authoritative. Do not add a Judgment-specific action guard or ask Host/model to judge the effect a second time.

## Failure semantics

- Invalid `UserPromptSubmit` input, bridge failure after bounded retry, binding rejection, digest mismatch, unmanaged binding, or invalid active definitions blocks model generation visibly.
- A managed clarification receipt proceeds to model generation.
- A conflicting same-turn episode or tool-use event fails loudly; it is never overwritten.
- Orphan `PostToolUse`/`Stop` events with no matching episode are ignored rather than fabricating evidence.
- Missing required knowledge causes one continuation. The repeated Stop finalizes `incomplete`, preserving the failure as audit evidence without an infinite hook loop.
- Preserve specific 4xx codes such as `judgment_resolution_input_invalid`; do not flatten them into a generic API error.
- `brainbase_project_not_accessible` must not arise merely because project policy is outside the caller scope.

## Runtime and deployment

Register the canonical deployed wrapper for all three user-level hooks in `~/.codex/hooks.json`:

```json
{
  "hooks": {
    "UserPromptSubmit": [{"hooks": [{"type": "command", "command": "bash /Users/ksato/workspace/code/brainbase/scripts/codex-hooks/judgment-resolver-entry.sh"}]}],
    "PostToolUse": [{"matcher": "^mcp__brainbase__.*$", "hooks": [{"type": "command", "command": "bash /Users/ksato/workspace/code/brainbase/scripts/codex-hooks/judgment-resolver-entry.sh"}]}],
    "Stop": [{"hooks": [{"type": "command", "command": "bash /Users/ksato/workspace/code/brainbase/scripts/codex-hooks/judgment-resolver-entry.sh"}]}]
  }
}
```

The bridge defaults to `http://127.0.0.1:39002/host/judgment/resolve` and remains loopback-only. The API/MCP signing secret is `BRAINBASE_JUDGMENT_BINDING_SECRET`; never put it in model context, command arguments, logs, or receipts. A fresh Codex session may require the new Hook definitions to be trusted through `/hooks`.

### Verification

```bash
scripts/run-brainbase-mcp.sh --check
npm run test:judgment-resolution
npm --prefix mcp/brainbase run typecheck
npm run typecheck
cmp -s CLAUDE.md AGENTS.md
```

The preflight is a signed read-only probe. A successful probe is not proof that the global hook, all lifecycle events, or persistent runtime uses the new checkout. Verify deployed commit, actual Hook config, one fresh turn, PostToolUse event count, Stop final status, and owner-visible wording separately.

### Rollback

Restore the previous user hook file and compatible deployed checkout, rerun the signed preflight, and verify a fresh turn. Until `UserPromptSubmit` can open a valid episode, model generation stays stopped. PostToolUse/Stop rollback must not delete existing journals; they remain audit evidence.
