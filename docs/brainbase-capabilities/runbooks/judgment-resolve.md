# Judgment episode runbook

Judgment Resolver is a Host lifecycle boundary. Every Codex turn opens one judgment episode because choosing how to answer is itself a judgment. The model does not call Resolver and does not author classification or `conversation_context`.

## Component responsibilities

| Component | Responsibility |
| --- | --- |
| Codex lifecycle Host adapter | Build canonical context, call the loopback bridge, verify the returned receipt binding, own the episode journal and lifecycle, and display evidence. It does not hold the Resolver signing secret. |
| Persistent Brainbase Host bridge | Hold the API token, its signer copy of the shared `BRAINBASE_JUDGMENT_BINDING_SECRET`, and adapter identity outside model context, then bind and sign the Resolver API request. |
| Resolver API/server | Hold the verifier copy of the same shared `BRAINBASE_JUDGMENT_BINDING_SECRET`, then verify the bridge signature and binding before invoking the Judgment Resolver service. |
| Judgment Resolver | Deterministically apply manifest-owned `semantic_matchers`, bounded prior-context inheritance, safety floors, and policies to select the initial route. It has no internal LLM. |
| Codex model | Act as the open-ended LLM inside the selected DAG: decide how to answer, refine queries from results, and call knowledge/retrieval tools 0..N times. |
| Knowledge Resolver | Deterministically select the canonical source route. It does not search or retrieve content. |
| Retrieval tools | Perform the actual Graph, Personal KG, repo, Drive, or wiki operations. The current episode records only direct `mcp__brainbase__*` outcomes through `PostToolUse`; local file reads and other connectors are outside that event matcher. |

## Turn flow

1. `UserPromptSubmit` sends the turn to `scripts/codex-hooks/judgment-resolver-entry.sh`.
2. The Codex lifecycle Host adapter validates the hook payload, reads the canonical JSONL transcript, and performs structural filtering. It preserves ordered raw user/assistant text while excluding envelopes, summaries, reasoning, tool arguments, and tool output.
3. Before model generation, the lifecycle adapter builds canonical `conversation_context` and calls loopback `POST /host/judgment/resolve`. The persistent Brainbase Host bridge binds and signs the Resolver API request, the Resolver API/server verifies that signature, and the lifecycle adapter verifies the returned receipt binding before atomically opening one episode with its initial route receipt.
4. The model follows only the returned active DAG. The Host-fixed initial route and classification are immutable; the model does not recalculate or change them. When `knowledge.resolve` is required, the initial context names the allowed exact tool `mcp__brainbase__brainbase_knowledge_resolve` and explains that this capability selects the canonical source and next retrieval path without retrieving the answer body. The same capability-action definition generates the first Stop repair instruction. The model may call Brainbase knowledge/retrieval tools 0..N times, using each result to decide the next lookup.
5. Every completed `mcp__brainbase__*` call triggers `PostToolUse`. The Host stores one immutable safe event and displays an accurate short line. Episode start, event commits, and Stop finalization for the same turn share one per-turn SQLite `BEGIN IMMEDIATE` transaction, so concurrent calls receive a unique `event_sequence` in atomic journal-commit order. Process exit releases the transaction lock through SQLite and the OS; the Host never guesses that a lock path is stale and deletes it. `brainbase_knowledge_resolve` selects a reference destination; it is not itself a search or retrieval.
6. `Stop` validates the event set and the actual `last_assistant_message`, then atomically creates one complete final episode receipt only when the episode-start contract is satisfied. The answer must begin with the stored `🧠` line followed by every stored `📚`/`⚠️` line in journal-commit order, with no extra copies. If required `knowledge.resolve` or that rendered audit prefix is missing, the first repairable Stop returns `decision:block` and writes no final receipt. If the `stop_hook_active=true` retry is still incomplete, it exits non-zero with `judgment_stop_repair_exhausted` instead of regenerating forever. When knowledge is optional and zero Brainbase calls were recorded, the episode-bound prefix includes `📚 Brainbase未参照: 必須参照なし・実呼び出し0回 ✓`. For an audit-only repair, the Host stores the normalized business-body digest and character count—not the answer text—after removing only the leading Host audit namespace block, including malformed variants. It refuses completion if the regenerated answer deleted, summarized, or replaced that body. A true orphan Stop cannot fabricate the model-generation-before route: it requests the exact degraded warning at most once, then records an immutable `audit_degraded` receipt and exits successfully so a long-running task does not require a new task. The warning explicitly says that work continues and that creating a new task or operating Hooks is unnecessary. `audit_degraded` is never a complete final, retrieval success, task completion, prior finalized judgment, or action authorization. Identity, diagnostic-integrity, episode-integrity, and transaction-acquisition failures remain terminal fail-closed errors.

## Canonical conversation context

`conversation_context` uses schema `brainbase-conversation-context-v1` and contains:

- hashed `session_ref`; no raw session ID or absolute transcript path
- ordered user/assistant messages with turn identity and exact text
- projections of prior complete finalized episodes
- runtime host, model, permission mode, and project binding
- repo-relative instruction bindings with content digests
- completeness marker and canonical `source_digest`

The Host does not summarize history or guess semantic relevance. Resolver uses deterministic manifest-backed matching to classify the canonical context and select the initial route; the current runtime does not call an LLM provider. Non-follow-up input with no explicit specialist match uses the server-owned `general/answer` fallback. An unresolved follow-up reference or a knowledge route without required project context uses the clarification DAG. The current Codex model then owns open-ended query formulation and iterative investigation inside that route. Claude Code is a future Host-adapter candidate for the same responsibility split, but is not part of the current episode-lifecycle hook integration. Project binding is judgment context, not action authority; inaccessible project policy is omitted without making general judgment unavailable.

## Episode journal

For each hashed session/turn, the Host maintains owner-only append-only files:

```text
<turn>.episode.json
<turn>.events/<sha256(tool_use_id)>.json
<turn>.continuation.json
<turn>.final.json
```

- `episode.json` binds the turn to its canonical request/context and initial route.
- `episode.json` also binds the exact owner-audit contract used by Stop. A runtime deployment does not retroactively add a display requirement to an already-open episode. Legacy episodes without this binding use the legacy minimum prefix instead of adopting the current runtime contract.
- Every event stores tool identity, outcome, bounded safe projection, and digests; raw arguments, raw responses, secrets, absolute paths, and unbounded text are not saved.
- `continuation.json` proves that one required-capability or owner-display continuation was requested. An audit-only continuation may also bind the normalized non-audit body digest and character count; it never stores the answer body itself.
- `final.json` binds the immutable event-set digest, exact answer digest, owner-display status, and records `complete`. Historical incomplete journals remain readable but are not newly created.

Initial route and final episode receipt are different facts. The initial route says what should guide the turn. The final receipt says what actually happened before Stop. Only complete finalized episodes become prior-receipt context; legacy v1/v2 adoption journals remain readable.

## Owner-visible traces

The final user-facing response starts with the stored initial judgment line once, after all Brainbase calls are known. Intermediate commentary does not carry the audit block:

```text
🧠 判断参照: 直前の「ログイン後の白画面」を参照 → 実装依頼として継続 ✓
```

Each actual Brainbase call gets its own `PostToolUse` trace. The wording must match the operation:

```text
📚 Brainbase参照先: 「監査方法」→ owning_repoのdocs/を選択 ✓
📚 Brainbase検索: 「Judgment Resolver」→ Graphを検索 ✓
📚 Brainbase取得: decision:abc123を取得 ✓
```

Never show `検索` or `取得` for `brainbase_knowledge_resolve`; it only selects a route. A failed call uses a warning form and cannot satisfy a required capability. A successful `unconfirmed` result does satisfy the routing capability because the route decision ran and correctly preserved that no canonical source could be confirmed; display that uncertainty instead of claiming retrieval success.

The additional context and `PostToolUse.systemMessage` guide the model, but they are not accepted as owner-visible evidence by themselves. `Stop` checks the final answer and requests one corrected rendering when the stored lines are missing, duplicated, or out of journal-commit order. For an audit-only retry, it also requires the first rejected answer's business body to remain unchanged after presentation normalization. A leading reserved line beginning with `🧠 判断参照:`, `📚 Brainbase`, or `⚠️ Brainbase` is presentation metadata even when malformed; the same text after the business body starts remains body content. A short acknowledgement cannot replace the detailed implementation report. Trailing spaces or tabs at line ends are presentation-equivalent; the audit text, order, and multiplicity remain exact. An active repeated Stop exits non-zero with `judgment_stop_repair_exhausted` when the repair is still incomplete.

## Completion invariant

The invariant is exactly one episode per managed turn and at most one complete final receipt, not one Resolver network attempt and not one Brainbase tool call. Before episode creation, recognized transient failures may be retried within the Host limit. After creation, the same turn reuses the initial route. Tool calls may occur 0..N times. Replayed `PostToolUse` and complete `Stop` events reuse their immutable records.

If `required_capabilities` contains `knowledge.resolve`, only a successful exact `mcp__brainbase__brainbase_knowledge_resolve` event with resolved/unconfirmed status satisfies it. Search, Graph reads, Personal KG reads, unrelated Brainbase calls, and failed route calls do not substitute for the routing decision.

## Authorization boundary

Initial and final receipts constrain reasoning and provide audit evidence. They do not authorize writes or external effects. Existing platform permissions, explicit approvals, and executor authorization remain authoritative. Do not add a Judgment-specific action guard or ask Host/model to judge the effect a second time.

## Failure semantics

- Invalid `UserPromptSubmit` input, bridge failure after bounded retry, binding rejection, digest mismatch, unmanaged binding, or invalid active definitions blocks model generation visibly.
- A managed clarification receipt proceeds to model generation.
- A conflicting same-turn episode or tool-use event fails loudly; it is never overwritten.
- A Host crash can leave an open episode journal, but SQLite and the OS release its per-turn transaction lock when the process exits. The next process can continue without stale-lock path reclamation.
- If a live transaction remains busy past the bounded wait, the first Stop returns a visible continuation failure; an active repeated Stop exits non-zero with an explicit stderr diagnostic and never reports `{}` unless a final receipt exists.
- Orphan `PostToolUse` events are not attached to an episode; each leaves a digest-only orphan marker and visible warning without consuming the Stop repair state. A late `UserPromptSubmit` after that marker is blocked with `judgment_orphan_tool_event_start_conflict`: the marker intentionally lacks the raw event required to reconstruct a complete audit, so starting a normal episode would falsely claim completeness. Orphan `Stop` writes a digest-only diagnostic and returns one visible block requesting the exact `⚠️ Brainbase監査未完了:` prefix while preserving the answer body. The next Stop for that identity records `audit_degraded` and exits 0 even if the warning/body verification booleans are false; it never fabricates `.final.json` or asks the operator to create a new task. Replayed first-phase payloads do not create another repair loop. Missing identity, diagnostic tampering, conflicting immutable evidence, and other Stop integrity failures remain explicit non-zero failures and may still suggest checking Hook trust in Settings → Hooks.
- Missing required knowledge or an invalid owner-visible audit prefix returns `decision:block` on the first repairable Stop without a final receipt; an incomplete active repeated Stop exits non-zero with `judgment_stop_repair_exhausted`.
- An audit-only repair that drops or summarizes the original answer body is rejected; the first Stop returns `decision:block`, and an incomplete active retry terminates without a final receipt.
- Preserve specific 4xx codes such as `judgment_resolution_input_invalid`; do not flatten them into a generic API error.
- `brainbase_project_not_accessible` must not arise merely because project policy is outside the caller scope.
- If a log or explanation refers to a "Resolver LLM", treat it as documentation drift unless a future architecture explicitly introduces and verifies such a provider.

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

The persistent Brainbase Host bridge defaults to `http://127.0.0.1:39002/host/judgment/resolve` and remains loopback-only. The bridge signer and Resolver API/server verifier hold the two runtime copies of the shared `BRAINBASE_JUDGMENT_BINDING_SECRET`; the Codex lifecycle Host adapter and any future Claude Code adapter must not hold or receive either copy. Never put the secret in model context, command arguments, logs, or receipts.

### Codex Hook readiness and trust

Files in `hooks.json`, a `config.toml` trust section, matching source content, and direct entrypoint tests prove only installation. Query the current Codex Host before creating live evidence:

```bash
npm run check:judgment-hook-readiness -- --cwd "$BRAINBASE_CANONICAL_ROOT"
```

The checker uses the official `hooks/list` RPC. On macOS it prefers the Codex Desktop bundled executable so a Rosetta Node process cannot accidentally route through an architecture-mismatched PATH wrapper; other environments fall back to `codex`, and `--codex-bin` remains available for an explicit override. It succeeds only when the canonical `UserPromptSubmit`, matching `PostToolUse`, and `Stop` definitions are enabled, matcher-correct, and currently trusted; the result is `ready_for_fresh_task`. `modified`, `untrusted`, missing, disabled, or matcher-mismatched state returns non-zero as `trust_required` or configuration error. Open `/hooks` and approve the three current Resolver Hooks, then rerun the checker. Repository scripts and deployment automation must never calculate or write Codex `trusted_hash`.

Trust approval affects the Host lifecycle boundary. Create a new Codex task after approval; an already-open task, a past transcript, or direct entrypoint invocation cannot prove current activation. Only a new task with matching episode/event/final journals and transcript evidence is `proven_active`.

### Pre-deployment rollback capture

Before changing any of the four runtime surfaces, capture the exact working Hook file and the independently observed SHA for each surface. Keep this directory until post-deployment verification and one fresh live turn have passed.

```bash
set -euo pipefail
export BRAINBASE_CANONICAL_ROOT=/Users/ksato/workspace/code/brainbase
export BRAINBASE_MCP_RUNTIME_ROOT=/Users/ksato/workspace/code/.worktrees/brainbase-mcp-runtime-45ec989ba
export BRAINBASE_ROLLBACK_STATE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/brainbase-judgment-rollback.XXXXXX")"
chmod 700 "$BRAINBASE_ROLLBACK_STATE_DIR"

test -z "$(git -C "$BRAINBASE_CANONICAL_ROOT" status --porcelain)"
test -z "$(git -C "$BRAINBASE_MCP_RUNTIME_ROOT" status --porcelain --untracked-files=no)"
cp "$HOME/.codex/hooks.json" "$BRAINBASE_ROLLBACK_STATE_DIR/hooks.json"
chmod 600 "$BRAINBASE_ROLLBACK_STATE_DIR/hooks.json"
shasum -a 256 "$BRAINBASE_ROLLBACK_STATE_DIR/hooks.json" > "$BRAINBASE_ROLLBACK_STATE_DIR/hooks.sha256"
HOOKS_FILE="$BRAINBASE_ROLLBACK_STATE_DIR/hooks.json" node <<'NODE' \
  > "$BRAINBASE_ROLLBACK_STATE_DIR/global-hook.entrypoint"
const hooks = JSON.parse(require('node:fs').readFileSync(process.env.HOOKS_FILE, 'utf8')).hooks ?? {};
const events = ['UserPromptSubmit', 'PostToolUse', 'Stop'];
const resolved = events.map((event) => {
  const commands = (hooks[event] ?? []).flatMap((group) => group.hooks ?? [])
    .filter((hook) => hook.type === 'command')
    .map((hook) => String(hook.command ?? ''));
  const paths = commands.flatMap((command) => {
    const match = command.match(/(\/[^\s"']+\/scripts\/codex-hooks\/judgment-resolver-entry\.sh)\b/);
    return match ? [match[1]] : [];
  });
  if (paths.length !== 1) throw new Error(`expected one Resolver entrypoint for ${event}`);
  return paths[0];
});
if (new Set(resolved).size !== 1) throw new Error('Resolver lifecycle hooks resolve to different entrypoints');
process.stdout.write(resolved[0]);
NODE
BRAINBASE_HOOK_ENTRYPOINT="$(cat "$BRAINBASE_ROLLBACK_STATE_DIR/global-hook.entrypoint")"
BRAINBASE_HOOK_ROOT="$(git -C "$(dirname "$BRAINBASE_HOOK_ENTRYPOINT")" rev-parse --show-toplevel)"
test -z "$(git -C "$BRAINBASE_HOOK_ROOT" status --porcelain --untracked-files=no)"
printf '%s\n' "$BRAINBASE_HOOK_ROOT" > "$BRAINBASE_ROLLBACK_STATE_DIR/global-hook.root"
git -C "$BRAINBASE_HOOK_ROOT" rev-parse HEAD > "$BRAINBASE_ROLLBACK_STATE_DIR/global-hook.sha"
curl -fsS http://127.0.0.1:31013/api/version | node -e '
const value=JSON.parse(require("node:fs").readFileSync(0,"utf8"));
const git=value.runtime?.git;
if (!/^[0-9a-f]{40}$/.test(git?.sha||"") || git?.dirty !== false) process.exit(1);
process.stdout.write(`${git.sha}\n`);
' > "$BRAINBASE_ROLLBACK_STATE_DIR/local-ui.sha"
git -C "$BRAINBASE_MCP_RUNTIME_ROOT" rev-parse HEAD > "$BRAINBASE_ROLLBACK_STATE_DIR/mcp-runtime.sha"
ssh -i "$HOME/.ssh/lightsail-brainbase.pem" ubuntu@176.34.20.239 \
  'cd /home/ubuntu/brainbase && test -z "$(git status --porcelain)" && git rev-parse HEAD' \
  > "$BRAINBASE_ROLLBACK_STATE_DIR/lightsail.sha"

for file in global-hook.sha local-ui.sha mcp-runtime.sha lightsail.sha; do
  grep -Eq '^[0-9a-f]{40}$' "$BRAINBASE_ROLLBACK_STATE_DIR/$file"
done
printf 'Rollback state: %s\n' "$BRAINBASE_ROLLBACK_STATE_DIR"
```

Do not infer one surface SHA from another. The files intentionally preserve all four observed values even when they currently match.

### Verification

```bash
scripts/run-brainbase-mcp.sh --check
npm run test:judgment-resolution
npm --prefix mcp/brainbase run typecheck
npm run typecheck
cmp -s CLAUDE.md AGENTS.md
npm run check:judgment-hook-readiness -- --cwd "$BRAINBASE_CANONICAL_ROOT"
```

The bridge preflight is a signed read-only probe. It is not proof that the global hook or all lifecycle events use the new checkout. The readiness checker separately proves current Host trust and returns `ready_for_fresh_task`; it still does not prove that any task executed the Hooks. Verify the deployed commit, then create one new task after trust approval and inspect its PostToolUse event count, complete Stop final, and owner-visible wording.

To verify the live Codex path, first bind the contract checkout and a unique nonce:

```bash
export BRAINBASE_JUDGMENT_E2E_EXPECTED_HEAD="$(git rev-parse HEAD)"
export BRAINBASE_JUDGMENT_E2E_NONCE="jr-e2e-$(date +%s)"
export BRAINBASE_JUDGMENT_E2E_RUN_QUERY="E2E-${BRAINBASE_JUDGMENT_E2E_NONCE}-${BRAINBASE_JUDGMENT_E2E_EXPECTED_HEAD}"
printf 'Use this exact verification query in the first two lookups: %s\n' "$BRAINBASE_JUDGMENT_E2E_RUN_QUERY"
```

After the readiness checker reports `ready_for_fresh_task`, start a new Codex task and include that printed query in a request that makes the model perform this bounded result-dependent lookup: resolve the canonical source for the Judgment Resolver contract with that query, search Graph with the same query, broaden the expected zero-result search to `判断`, then retrieve the returned `glossary_term` entity. After the task completes, bind the one episode containing that nonce and run the check:

```bash
JUDGMENT_E2E_CANDIDATES="$(
  rg -l --fixed-strings "$BRAINBASE_JUDGMENT_E2E_NONCE" \
    "${CODEX_HOME:-$HOME/.codex}/var/judgment-resolver" -g '*.json' \
    | sed -E 's#\.events/[^/]+\.json$#.episode.json#' \
    | grep '\.episode\.json$' \
    | sort -u
)"
test "$(printf '%s\n' "$JUDGMENT_E2E_CANDIDATES" | sed '/^$/d' | wc -l | tr -d ' ')" = 1
export BRAINBASE_JUDGMENT_E2E_EPISODE_PATH="$JUDGMENT_E2E_CANDIDATES"
JUDGMENT_E2E_TRANSCRIPTS="$(
  rg --follow -l --fixed-strings "$BRAINBASE_JUDGMENT_E2E_RUN_QUERY" \
    "${CODEX_HOME:-$HOME/.codex}/sessions" -g '*.jsonl' \
    | sort -u
)"
test "$(printf '%s\n' "$JUDGMENT_E2E_TRANSCRIPTS" | sed '/^$/d' | wc -l | tr -d ' ')" = 1
export BRAINBASE_JUDGMENT_E2E_TRANSCRIPT_PATH="$JUDGMENT_E2E_TRANSCRIPTS"
node --test tests/e2e/story-brainbase-judgment-resolver-v1-live-session.spec.ts
```

The command fails if the current `hooks/list` state is not `ready_for_fresh_task`, if the transcript task was created before the current Hook/trust files, if the nonce resolves to zero or multiple episodes/transcripts, or if the query-embedded source HEAD differs from `BRAINBASE_JUDGMENT_E2E_EXPECTED_HEAD`; it also requires that the final receipt is at most one hour old. It reads the installed global Hook bindings, the owner-only journal, and the exact Codex JSONL transcript. It passes only when `UserPromptSubmit`, `PostToolUse`, and `Stop` resolve to the same installed entrypoint, both lifecycle adapter files at every resolved Hook root are content-equivalent to the current contract checkout, the post-approval fresh episode has a verified initial route, the four successful Brainbase events preserve the result-dependent query sequence, and the final user-visible `response_item` starts with the stored `🧠` plus every stored `📚`/`⚠️` line exactly in journal-commit order. The final receipt answer digest binds the exact Stop Hook-visible answer body. When comparing the transcript, the verifier may exclude only one complete trailing `<oai-mem-citation>...</oai-mem-citation>` block added later by the Codex application; an incomplete, embedded, or multiple citation block remains part of the comparison and fails closed on mismatch. This result is `proven_active`; it is not proof that the installed Hook checkout has the same Git SHA as the contract checkout. The check does not manufacture tool events or treat a synthetic entrypoint test as live model evidence.

Verify the merged/deployed checkout SHA separately after deployment. Use one target SHA and prove each deployment surface independently; do not infer complete deployment from only one row:

| Surface | Proof |
| --- | --- |
| Global Codex lifecycle Hook checkout | Resolve all three entrypoint commands from `~/.codex/hooks.json`; they must name the same absolute entrypoint. Run `git -C <resolved-checkout-root> rev-parse HEAD` and `git -C <resolved-checkout-root> status --short`; the SHA must equal the merged target and the checkout must be clean. |
| Canonical local UI/API | Follow [`verify-31013-source.md`](./verify-31013-source.md). `GET http://127.0.0.1:31013/api/version` must report the target SHA with `dirty=false`; use [`restart-31013-launchd.md`](./restart-31013-launchd.md) when restart is required. |
| Persistent MCP Host bridge | Run `scripts/reconcile-brainbase-mcp-runtime.sh "$TARGET_SHA"`, then `scripts/run-brainbase-mcp.sh --check`. `/Users/ksato/workspace/var/brainbase-mcp-reconcile.last` must contain `sha=$TARGET_SHA`, and `launchctl print gui/$(id -u)/com.brainbase.mcp-brainbase` must report a running job. |
| Lightsail Resolver API/server | Follow [`deploy-lightsail-production.md`](./deploy-lightsail-production.md). Both the instance and public `GET /api/version` must report the target SHA with `dirty=false`, and public health plus the authenticated Graph probe must pass. |

Set `TARGET_SHA` from the merge result, not from an unmerged review checkout. Content-equivalent installed Hook files prove adapter activation before merge; only the checkout, reconciliation receipt, and version checks above prove post-merge SHA alignment.

### Rollback

Use the captured directory; do not guess a previous tag or delete any episode journals. The order below restores the canonical Host/UI checkout, persistent MCP runtime, Lightsail Resolver, and finally the exact Hook configuration. It uses detached known-good commits and never resets a branch.

```bash
set -euo pipefail
: "${BRAINBASE_ROLLBACK_STATE_DIR:?Set this to the captured rollback directory}"
export BRAINBASE_CANONICAL_ROOT=/Users/ksato/workspace/code/brainbase
export BRAINBASE_MCP_RUNTIME_ROOT=/Users/ksato/workspace/code/.worktrees/brainbase-mcp-runtime-45ec989ba
for file in hooks.json hooks.sha256 global-hook.entrypoint global-hook.root global-hook.sha local-ui.sha mcp-runtime.sha lightsail.sha; do
  test -s "$BRAINBASE_ROLLBACK_STATE_DIR/$file"
done
test -z "$(git -C "$BRAINBASE_CANONICAL_ROOT" status --porcelain)"
test -z "$(git -C "$BRAINBASE_MCP_RUNTIME_ROOT" status --porcelain --untracked-files=no)"
BRAINBASE_HOOK_ENTRYPOINT="$(cat "$BRAINBASE_ROLLBACK_STATE_DIR/global-hook.entrypoint")"
BRAINBASE_HOOK_ROOT="$(cat "$BRAINBASE_ROLLBACK_STATE_DIR/global-hook.root")"
test -f "$BRAINBASE_HOOK_ENTRYPOINT"
test "$(git -C "$(dirname "$BRAINBASE_HOOK_ENTRYPOINT")" rev-parse --show-toplevel)" = "$BRAINBASE_HOOK_ROOT"

# 1. Restore the checkout used by the local :31013 runtime.
FAILED_CANONICAL_SHA="$(git -C "$BRAINBASE_CANONICAL_ROOT" rev-parse HEAD)"
CANONICAL_ROLLBACK_SHA="$(cat "$BRAINBASE_ROLLBACK_STATE_DIR/local-ui.sha")"
git -C "$BRAINBASE_CANONICAL_ROOT" cat-file -e "${CANONICAL_ROLLBACK_SHA}^{commit}"
git -C "$BRAINBASE_CANONICAL_ROOT" switch --detach "$CANONICAL_ROLLBACK_SHA"
if ! git -C "$BRAINBASE_CANONICAL_ROOT" diff --quiet \
  "$CANONICAL_ROLLBACK_SHA" "$FAILED_CANONICAL_SHA" -- package.json package-lock.json; then
  npm --prefix "$BRAINBASE_CANONICAL_ROOT" ci
fi
launchctl kickstart -k "gui/$(id -u)/com.brainbase.ui"
sleep 5
test "$(curl -fsS http://127.0.0.1:31013/api/version | node -e '
const value=JSON.parse(require("node:fs").readFileSync(0,"utf8"));
process.stdout.write(value.runtime?.git?.dirty===false ? value.runtime.git.sha : "");
')" = "$(cat "$BRAINBASE_ROLLBACK_STATE_DIR/local-ui.sha")"

# 2. Restore and rebuild the persistent MCP checkout without using the
# forward-only reconcile helper.
FAILED_MCP_SHA="$(git -C "$BRAINBASE_MCP_RUNTIME_ROOT" rev-parse HEAD)"
MCP_ROLLBACK_SHA="$(cat "$BRAINBASE_ROLLBACK_STATE_DIR/mcp-runtime.sha")"
git -C "$BRAINBASE_MCP_RUNTIME_ROOT" cat-file -e "${MCP_ROLLBACK_SHA}^{commit}"
git -C "$BRAINBASE_MCP_RUNTIME_ROOT" switch --detach "$MCP_ROLLBACK_SHA"
if ! git -C "$BRAINBASE_MCP_RUNTIME_ROOT" diff --quiet \
  "$MCP_ROLLBACK_SHA" "$FAILED_MCP_SHA" -- mcp/brainbase/package.json mcp/brainbase/package-lock.json; then
  npm --prefix "$BRAINBASE_MCP_RUNTIME_ROOT/mcp/brainbase" ci
fi
npm --prefix "$BRAINBASE_MCP_RUNTIME_ROOT/mcp/brainbase" run build
(cd "$BRAINBASE_MCP_RUNTIME_ROOT" && scripts/run-brainbase-mcp.sh --check)
launchctl kickstart -k "gui/$(id -u)/com.brainbase.mcp-brainbase"
sleep 3
launchctl print "gui/$(id -u)/com.brainbase.mcp-brainbase" | grep -q 'state = running'
printf 'sha=%s\ncompleted_at=%s\n' "$MCP_ROLLBACK_SHA" "$(date -u +%FT%TZ)" \
  > /Users/ksato/workspace/var/brainbase-mcp-reconcile.last

# 3. Restore a separately installed global Hook checkout when it is neither the
# local UI nor persistent MCP checkout. The current deployment may share either.
HOOK_ROLLBACK_SHA="$(cat "$BRAINBASE_ROLLBACK_STATE_DIR/global-hook.sha")"
if [ "$BRAINBASE_HOOK_ROOT" != "$BRAINBASE_CANONICAL_ROOT" ] \
  && [ "$BRAINBASE_HOOK_ROOT" != "$BRAINBASE_MCP_RUNTIME_ROOT" ]; then
  test -z "$(git -C "$BRAINBASE_HOOK_ROOT" status --porcelain --untracked-files=no)"
  FAILED_HOOK_SHA="$(git -C "$BRAINBASE_HOOK_ROOT" rev-parse HEAD)"
  git -C "$BRAINBASE_HOOK_ROOT" cat-file -e "${HOOK_ROLLBACK_SHA}^{commit}"
  git -C "$BRAINBASE_HOOK_ROOT" switch --detach "$HOOK_ROLLBACK_SHA"
  if ! git -C "$BRAINBASE_HOOK_ROOT" diff --quiet \
    "$HOOK_ROLLBACK_SHA" "$FAILED_HOOK_SHA" -- package.json package-lock.json; then
    npm --prefix "$BRAINBASE_HOOK_ROOT" ci
  fi
fi
test "$(git -C "$BRAINBASE_HOOK_ROOT" rev-parse HEAD)" = "$HOOK_ROLLBACK_SHA"

# 4. Restore Lightsail, reinstall dependencies only when its manifest changed,
# and prove both the instance and public proxy report the captured SHA.
ssh -i "$HOME/.ssh/lightsail-brainbase.pem" ubuntu@176.34.20.239 bash -s -- \
  "$(cat "$BRAINBASE_ROLLBACK_STATE_DIR/lightsail.sha")" <<'REMOTE'
set -euo pipefail
ROLLBACK_SHA="$1"
cd /home/ubuntu/brainbase
test -z "$(git status --porcelain)"
FAILED_SHA="$(git rev-parse HEAD)"
git cat-file -e "${ROLLBACK_SHA}^{commit}"
git switch --detach "$ROLLBACK_SHA"
if ! git diff --quiet "$ROLLBACK_SHA" "$FAILED_SHA" -- package.json package-lock.json; then
  npm ci --omit=dev
fi
sudo systemctl restart brainbase-ssot.service
sleep 3
curl -fsS http://127.0.0.1:55123/api/version | TARGET_SHA="$ROLLBACK_SHA" node -e '
const value=JSON.parse(require("node:fs").readFileSync(0,"utf8"));
const git=value.runtime?.git;
if (git?.sha!==process.env.TARGET_SHA || git?.dirty!==false) process.exit(1);
'
REMOTE
TARGET_SHA="$(cat "$BRAINBASE_ROLLBACK_STATE_DIR/lightsail.sha")"
curl -fsS https://bb.unson.jp/api/version | TARGET_SHA="$TARGET_SHA" node -e '
const value=JSON.parse(require("node:fs").readFileSync(0,"utf8"));
const git=value.runtime?.git;
if (git?.sha!==process.env.TARGET_SHA || git?.dirty!==false) process.exit(1);
'

# 5. Restore the exact previous Hook config last, then verify every surface.
install -m 600 "$BRAINBASE_ROLLBACK_STATE_DIR/hooks.json" "$HOME/.codex/hooks.json"
(cd "$BRAINBASE_ROLLBACK_STATE_DIR" && shasum -a 256 -c hooks.sha256)
test "$(git -C "$BRAINBASE_HOOK_ROOT" rev-parse HEAD)" = "$(cat "$BRAINBASE_ROLLBACK_STATE_DIR/global-hook.sha")"
test -z "$(git -C "$BRAINBASE_HOOK_ROOT" status --porcelain --untracked-files=no)"
test -z "$(git -C "$BRAINBASE_CANONICAL_ROOT" status --porcelain)"
(cd "$BRAINBASE_CANONICAL_ROOT" && scripts/run-brainbase-mcp.sh --check)
curl -fsS -o /dev/null https://bb.unson.jp/api/health
```

After these commands, run one fresh Codex turn and the live transcript verification above. Until `UserPromptSubmit` opens a valid episode and the final transcript shows the exact audit prefix, report the rollback as incomplete. Never remove `~/.codex/var/judgment-resolver`; its existing episode/event/final files remain audit evidence.
