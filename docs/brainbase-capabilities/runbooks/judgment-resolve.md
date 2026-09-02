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
| Retrieval tools | Perform the actual Graph, Personal KG, repo, Drive, or wiki operations. The current episode records every completed tool call as execution evidence through `PostToolUse`; direct `mcp__brainbase__*` outcomes additionally produce owner-visible Brainbase audit lines. |

## Turn flow

1. `UserPromptSubmit` sends the turn to `scripts/codex-hooks/judgment-resolver-entry.sh`.
2. The Codex lifecycle Host adapter validates the hook payload, reads the canonical JSONL transcript, and performs structural filtering. It preserves ordered raw user/assistant text while excluding envelopes, summaries, reasoning, tool arguments, and tool output.
3. Before model generation, the lifecycle adapter builds canonical `conversation_context` and calls loopback `POST /host/judgment/resolve`. The persistent Brainbase Host bridge binds and signs the Resolver API request, the Resolver API/server verifies that signature, and the lifecycle adapter verifies the returned receipt binding before atomically opening one episode with its initial route receipt.
4. The model follows only the returned active DAG. The Host-fixed initial route and classification are immutable; the model does not recalculate or change them. When `knowledge.resolve` is required, the initial context names the allowed exact tool `mcp__brainbase__brainbase_knowledge_resolve` and explains that this capability selects the canonical source and next retrieval path without retrieving the answer body. The same capability-action definition generates the first Stop repair instruction. The model may call Brainbase knowledge/retrieval tools 0..N times, using each result to decide the next lookup.
5. Every completed tool call triggers `PostToolUse`. The Host stores one immutable safe event; direct `mcp__brainbase__*` calls also display an accurate short owner audit line, while other tools remain non-visible execution evidence. Episode start, event commits, and Stop finalization for the same turn share one per-turn SQLite `BEGIN IMMEDIATE` transaction, so concurrent calls receive a unique `event_sequence` in atomic journal-commit order. Process exit releases the transaction lock through SQLite and the OS; the Host never guesses that a lock path is stale and deletes it. `brainbase_knowledge_resolve` selects a reference destination; it is not itself a search or retrieval.
6. `Stop` validates the event set and the actual `last_assistant_message`, then atomically creates one complete final episode receipt only when the episode-start contract is satisfied. The answer must begin with the stored `🧠` line followed by every stored `📚`/`⚠️` line in journal-commit order, with no extra copies. If a `continue` receipt detects an unnecessary user question, the first Stop returns `decision:block` plus `systemMessage: 🔁 確認不要と判定しました。回答を差し戻して処理を続けています` and stores count `1`, trigger, Resolver reason, and `requested` status in immutable `continuation.json`. The retry must add `🔁 自律継続: 不要な確認を1回差し戻し → 継続完了 ✓` after the Brainbase audit lines; final then records the same structured evidence with `completed` status. Every repairable Stop rejection also stores `stop_repair: { count: 1, status: requested }`. A successful retry must add `🛠️ Stop修復: 最終回答を1回差し戻し → 修復完了 ✓`; final records the same marker with `completed` status. A `🔁` or `🛠️` line authored by the model without matching journal evidence is rejected. If required `knowledge.resolve` or that rendered audit prefix is missing, the first repairable Stop returns `decision:block` and writes no final receipt. If the `stop_hook_active=true` retry is still incomplete, it exits non-zero with `judgment_stop_repair_exhausted` instead of regenerating forever. When knowledge is optional and zero Brainbase calls were recorded, the episode-bound prefix includes `📚 Brainbase未参照: 必須参照なし・実呼び出し0回 ✓`. For an audit-only repair, the Host stores the normalized business-body digest and character count—not the answer text—after removing only the leading Host audit namespace block, including malformed variants. It refuses completion if the regenerated answer deleted, summarized, or replaced that body. A true orphan Stop cannot fabricate the model-generation-before route: it requests the exact degraded warning at most once, then records an immutable `audit_degraded` receipt and exits successfully so a long-running task does not require a new task. The warning explicitly says that work continues and that creating a new task or operating Hooks is unnecessary. `audit_degraded` is never a complete final, retrieval success, task completion, prior finalized judgment, or action authorization. Identity, diagnostic-integrity, episode-integrity, and transaction-acquisition failures remain terminal fail-closed errors.

## Autonomy contract

For implement/operate requests on runtime 2.4 or later, Stop does not infer completion from prose or an answer marker. The model calls `brainbase_judgment_state_record` as its final tool call; PostToolUse binds the state to the current episode journal. `pending` or `pending_safe_work=true` is rejected with trigger `unfinished_safe_work`; `waiting_human` passes only when its reason code matches both the allowed runtime reasons and the visible `⚠️` marker; `completed` passes only when the state event is last and at least one earlier successful same-episode execution event exists. Missing, malformed, or stale state fails closed. Runtime 2.3 retains the answer marker and runtime 2.2 retains the prose detector only as rollout compatibility. The state is never rendered in the user-facing answer. A successful retry requires the episode-bound `🔁 実行継続: 方針説明での停止を1回差し戻し → 作業完了 ✓` line. This deterministic state-and-evidence boundary does not change `content_verification_status=not_evaluated` into semantic verification; tests, readback, and domain checks still establish whether the executed change is correct.

The initial receipt fixes `autonomy_decision` deterministically. Low/medium-risk in-scope work is `continue`; high/critical risk, external action, unresolved classification, or policy conflict is `escalate`. New runtime receipts supersede the legacy Stop-time model evaluator, which remains only for already-open legacy episodes during rollout.

Stop does not ask another model to grade the answer. It mechanically checks that a `continue` turn did not hand routine work back as an unnecessary question. Runtime escalation is allowed only for `irreversible_action`, `missing_authority`, `owner_value_choice`, `required_input_unavailable`, or `evidenced_terminal_blocker`, using an exact `⚠️ 確認が必要[reason_code]:` line. An `escalate` turn must ask one necessary question with the Resolver reason. This contract never grants action permission.

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
- `continuation.json` proves that one required-capability, owner-display, autonomy, or Stop-repair continuation was requested. An autonomy continuation stores only structured count, trigger, Resolver reason, and status. Every repairable rejection stores one `stop_repair` count and status. Both progress/completion wordings are fixed and digest-bound in `episode.json`; a final receipt changes their status to `completed`. An audit-only continuation may also bind the normalized non-audit body digest and character count; it never stores the answer body itself.
- `final.json` binds the immutable event-set digest, exact answer digest, owner-display status, and records `complete`. Historical incomplete journals remain readable but are not newly created.

Initial route and final episode receipt are different facts. The initial route says what should guide the turn. The final receipt says what actually happened before Stop. Only complete finalized episodes become prior-receipt context; legacy v1/v2 adoption journals remain readable.

`final.json` also records whether autonomy was `continued`, `runtime_escalated`, or `escalated`; this is answer-contract evidence, not semantic proof that every implementation claim is true.

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

Never show `検索` or `取得` for `brainbase_knowledge_resolve`; it only selects a route. An authentic canonical route `PostToolUse` event satisfies the execution requirement even when the result is `unconfirmed` or the tool fails, because the route was already invoked and must not be duplicated. Only `resolved` is a successful routing result; `unconfirmed` and tool failure remain warning outcomes with `success=false` and must not claim a selected source or retrieval success.

The additional context and Hook `systemMessage` guide the model and may show short in-progress status, but they are not accepted as final owner-visible evidence by themselves. `Stop` checks the final answer and requests one corrected rendering when the stored lines are missing, duplicated, or out of journal-commit order. For an audit-only retry, it also requires the first rejected answer's business body to remain unchanged after presentation normalization. A leading reserved line beginning with `🧠 判断参照:`, `📚 Brainbase`, `⚠️ Brainbase`, `🔁 `, or `🛠️ ` is presentation metadata even when malformed; the same text after the business body starts remains body content except that an unjournaled `🔁` or `🛠️` completion claim is always rejected. A journal-proven successful retry appends exactly one `🛠️ Stop修復: 最終回答を1回差し戻し → 修復完了 ✓` after the other audit lines; a normal turn has no repair line. A short acknowledgement cannot replace the detailed implementation report. Trailing spaces or tabs at line ends are presentation-equivalent; the audit text, order, and multiplicity remain exact. An active repeated Stop exits non-zero with `judgment_stop_repair_exhausted` when the repair is still incomplete.

## Completion invariant

The invariant is exactly one episode per managed turn and at most one complete final receipt, not one Resolver network attempt and not one Brainbase tool call. Before episode creation, recognized transient failures may be retried within the Host limit. After creation, the same turn reuses the initial route. Tool calls may occur 0..N times. Replayed `PostToolUse` and complete `Stop` events reuse their immutable records.

If `required_capabilities` contains `knowledge.resolve`, one authentic exact `mcp__brainbase__brainbase_knowledge_resolve` `PostToolUse` event satisfies the execution requirement regardless of response outcome. Only `resolved` qualifies as successful; `unconfirmed` and tool failure remain non-qualifying warning results. Search, Graph reads, Personal KG reads, unrelated Brainbase calls, and retrievals do not substitute for executing the routing tool.

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

A `continue` receipt that ends in an unapproved decision request returns `decision:block` so the model continues. An `escalate` receipt without the exact reason marker and necessary input request is also blocked.

## Runtime and deployment

Register the canonical deployed wrapper for all three user-level hooks in `~/.codex/hooks.json`:

```json
{
  "hooks": {
    "UserPromptSubmit": [{"hooks": [{"type": "command", "command": "bash /Users/ksato/workspace/repos/.runtime/brainbase-judgment-hook/scripts/codex-hooks/judgment-resolver-entry.sh"}]}],
    "PostToolUse": [{"matcher": ".*", "hooks": [{"type": "command", "command": "bash /Users/ksato/workspace/repos/.runtime/brainbase-judgment-hook/scripts/codex-hooks/judgment-resolver-entry.sh"}]}],
    "Stop": [{"hooks": [{"type": "command", "command": "bash /Users/ksato/workspace/repos/.runtime/brainbase-judgment-hook/scripts/codex-hooks/judgment-resolver-entry.sh"}]}]
  }
}
```

The persistent Brainbase Host bridge defaults to `http://127.0.0.1:39002/host/judgment/resolve` and remains loopback-only. The bridge signer and Resolver API/server verifier hold the two runtime copies of the shared `BRAINBASE_JUDGMENT_BINDING_SECRET`; the Codex lifecycle Host adapter and any future Claude Code adapter must not hold or receive either copy. Never put the secret in model context, command arguments, logs, or receipts.

### Codex Hook readiness and trust

Files in `hooks.json`, a `config.toml` trust section, matching source content, and direct entrypoint tests prove only installation. Query the current Codex Host before creating live evidence:

```bash
npm run check:judgment-hook-readiness -- --cwd "$BRAINBASE_CONTRACT_ROOT"
```

The checker uses the official `hooks/list` RPC. On macOS it prefers the Codex Desktop bundled executable so a Rosetta Node process cannot accidentally route through an architecture-mismatched PATH wrapper; other environments fall back to `codex`, and `--codex-bin` remains available for an explicit override. It succeeds only when the canonical `UserPromptSubmit`, matching `PostToolUse`, and `Stop` definitions are enabled, matcher-correct, and currently trusted; the result is `ready_for_fresh_task`. `modified`, `untrusted`, missing, disabled, or matcher-mismatched state returns non-zero as `trust_required` or configuration error. Open `/hooks` and approve the three current Resolver Hooks, then rerun the checker. Repository scripts and deployment automation must never calculate or write Codex `trusted_hash`.

Trust approval affects the Host lifecycle boundary. Create a new Codex task after approval; an already-open task, a past transcript, or direct entrypoint invocation cannot prove current activation. Only a new task with matching episode/event/final journals and transcript evidence is `proven_active`.

### Production dirty hotfix reconciliation

通常の事前取得は全実行面がcleanであることを要求する。Lightsailに既知の4ファイルだけのhotfixが残る場合は、先に以下で復旧専用commitへ保全する。`FORMAL_HOTFIX_COMMIT`はレビュー済みの同一hotfix commitを指定する。許可外の差分、patch ID不一致、退避物の欠落が1つでもあれば停止する。

```bash
set -euo pipefail
: "${FORMAL_HOTFIX_COMMIT:?Set the reviewed hotfix commit SHA}"
export BRAINBASE_DIRTY_RECONCILIATION_DIR="$(mktemp -d "${TMPDIR:-/tmp}/brainbase-production-hotfix.XXXXXX")"
chmod 700 "$BRAINBASE_DIRTY_RECONCILIATION_DIR"
printf '%s\n' "$FORMAL_HOTFIX_COMMIT" > "$BRAINBASE_DIRTY_RECONCILIATION_DIR/formal-hotfix.sha"
git cat-file -e "${FORMAL_HOTFIX_COMMIT}^{commit}"
git diff "${FORMAL_HOTFIX_COMMIT}^" "$FORMAL_HOTFIX_COMMIT" -- \
  mcp/brainbase/src/remote-judgment-hook-http.ts \
  mcp/brainbase/tests/auth/remote-judgment-hook-http.test.ts \
  scripts/codex-hooks/judgment-resolver-host.mjs \
  tests/unit/judgment-resolver-host.test.js \
  | git patch-id --stable | awk '{print $1}' \
  > "$BRAINBASE_DIRTY_RECONCILIATION_DIR/formal-hotfix.patch-id"

scp -i "$HOME/.ssh/lightsail-brainbase.pem" \
  "$BRAINBASE_DIRTY_RECONCILIATION_DIR/formal-hotfix.patch-id" \
  ubuntu@176.34.20.239:/tmp/brainbase-formal-hotfix.patch-id
RECONCILIATION_OUTPUT="$(ssh -i "$HOME/.ssh/lightsail-brainbase.pem" ubuntu@176.34.20.239 bash -s -- \
  "$(date -u +%Y%m%dT%H%M%SZ)" <<'REMOTE'
set -euo pipefail
STAMP="$1"
cd /home/ubuntu/brainbase
EXPECTED_FILES="$(cat <<'FILES'
mcp/brainbase/src/remote-judgment-hook-http.ts
mcp/brainbase/tests/auth/remote-judgment-hook-http.test.ts
scripts/codex-hooks/judgment-resolver-host.mjs
tests/unit/judgment-resolver-host.test.js
FILES
)"
ACTUAL_FILES="$(git status --porcelain --untracked-files=all | sed -E 's/^...//' | sort)"
test "$ACTUAL_FILES" = "$(printf '%s\n' "$EXPECTED_FILES" | sort)"
BACKUP_DIR="/home/ubuntu/brainbase-production-hotfix-$STAMP"
install -d -m 700 "$BACKUP_DIR"
git rev-parse HEAD > "$BACKUP_DIR/base.sha"
git status --porcelain --untracked-files=all > "$BACKUP_DIR/status.txt"
git diff --binary -- $EXPECTED_FILES > "$BACKUP_DIR/hotfix.patch"
test -s "$BACKUP_DIR/hotfix.patch"
sha256sum $EXPECTED_FILES > "$BACKUP_DIR/content.sha256"
git diff -- $EXPECTED_FILES | git patch-id --stable | awk '{print $1}' > "$BACKUP_DIR/hotfix.patch-id"
cmp -s "$BACKUP_DIR/hotfix.patch-id" /tmp/brainbase-formal-hotfix.patch-id
rm -f /tmp/brainbase-formal-hotfix.patch-id
ROLLBACK_BRANCH="rollback/production-hotfix-$STAMP"
git switch -c "$ROLLBACK_BRANCH"
git add -- $EXPECTED_FILES
git diff --cached --name-only | sort | diff -u - <(printf '%s\n' "$EXPECTED_FILES" | sort)
git commit -m 'chore(production): preserve deployed judgment hotfix'
test -z "$(git status --porcelain --untracked-files=all)"
git rev-parse HEAD > "$BACKUP_DIR/rollback.sha"
printf '%s\n' "$ROLLBACK_BRANCH" > "$BACKUP_DIR/rollback.branch"
sha256sum -c "$BACKUP_DIR/content.sha256" >/dev/null
printf 'BRAINBASE_LIGHTSAIL_HOTFIX_BACKUP_DIR=%s\n' "$BACKUP_DIR"
REMOTE
)"
printf '%s\n' "$RECONCILIATION_OUTPUT"
BRAINBASE_LIGHTSAIL_HOTFIX_BACKUP_DIR="$(
  printf '%s\n' "$RECONCILIATION_OUTPUT" \
    | node scripts/extract-lightsail-hotfix-backup-dir.mjs
)"
export BRAINBASE_LIGHTSAIL_HOTFIX_BACKUP_DIR
```

この時点のLightsailは、旧SHA＋hotfixと同じ実効内容を持つcleanなrollback commitである。同じshellで次の事前取得を実行し、`BRAINBASE_LIGHTSAIL_HOTFIX_BACKUP_DIR`をrollback stateへ必ず結合する。rollback時は保存済み`rollback.sha`へ戻し、`content.sha256`を照合する。

### Pre-deployment rollback capture

Before changing any of the four runtime surfaces, capture the exact working Hook file and the independently observed SHA for each surface. Keep this directory until post-deployment verification and one fresh live turn have passed.

```bash
set -euo pipefail
export BRAINBASE_SOURCE_ROOT=/Users/ksato/workspace/repos/brainbase
export BRAINBASE_UI_RUNTIME_ROOT=/Users/ksato/workspace/repos/.runtime/brainbase-31013
export BRAINBASE_MCP_RUNTIME_ROOT="$BRAINBASE_UI_RUNTIME_ROOT"
export BRAINBASE_RUNTIME_PIN_FILE=/Users/ksato/workspace/var/brainbase-runtime-pinned.sha
export BRAINBASE_ROLLBACK_STATE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/brainbase-judgment-rollback.XXXXXX")"
chmod 700 "$BRAINBASE_ROLLBACK_STATE_DIR"
if test -n "${BRAINBASE_LIGHTSAIL_HOTFIX_BACKUP_DIR:-}"; then
  printf '%s\n' "$BRAINBASE_LIGHTSAIL_HOTFIX_BACKUP_DIR" \
    > "$BRAINBASE_ROLLBACK_STATE_DIR/lightsail-hotfix-backup-dir"
fi
source "$BRAINBASE_SOURCE_ROOT/scripts/launchd/brainbase-runtime-readiness.sh"
CAPTURE_CONNECT_TIMEOUT_SECONDS="${BRAINBASE_RUNTIME_READINESS_CONNECT_TIMEOUT_SECONDS:-5}"
CAPTURE_MAX_TIMEOUT_SECONDS="${BRAINBASE_RUNTIME_READINESS_MAX_TIMEOUT_SECONDS:-10}"
brainbase_runtime_readiness_validate_positive_seconds "$CAPTURE_CONNECT_TIMEOUT_SECONDS" 'connect timeout'
brainbase_runtime_readiness_validate_positive_seconds "$CAPTURE_MAX_TIMEOUT_SECONDS" 'maximum request time'

require_git_root() {
  local root="$1" actual
  test -d "$root"
  test -d "$root/.git" -o -f "$root/.git"
  test "$(git -C "$root" rev-parse --is-inside-work-tree)" = true
  actual="$(git -C "$root" rev-parse --show-toplevel)"
  test "$(cd "$actual" && pwd -P)" = "$(cd "$root" && pwd -P)"
  git -C "$root" rev-parse HEAD >/dev/null
}
require_clean_tracked_root() {
  local root="$1" status
  require_git_root "$root"
  status="$(git -C "$root" status --porcelain --untracked-files=no)"
  test -z "$status"
}

# The source checkout may contain unrelated user changes. Validate its identity,
# but never require it to be clean and never switch/reset/clean/stash it.
require_git_root "$BRAINBASE_SOURCE_ROOT"
require_clean_tracked_root "$BRAINBASE_UI_RUNTIME_ROOT"
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
require_clean_tracked_root "$BRAINBASE_HOOK_ROOT"
printf '%s\n' "$BRAINBASE_HOOK_ROOT" > "$BRAINBASE_ROLLBACK_STATE_DIR/global-hook.root"
git -C "$BRAINBASE_HOOK_ROOT" rev-parse HEAD > "$BRAINBASE_ROLLBACK_STATE_DIR/global-hook.sha"
curl -fsS \
  --connect-timeout "$CAPTURE_CONNECT_TIMEOUT_SECONDS" \
  --max-time "$CAPTURE_MAX_TIMEOUT_SECONDS" \
  -- http://127.0.0.1:31013/api/version | node -e '
const value=JSON.parse(require("node:fs").readFileSync(0,"utf8"));
const git=value.runtime?.git;
if (!/^[0-9a-f]{40}$/.test(git?.sha||"") || git?.dirty !== false) process.exit(1);
process.stdout.write(`${git.sha}\n`);
' > "$BRAINBASE_ROLLBACK_STATE_DIR/local-ui.sha"
git -C "$BRAINBASE_MCP_RUNTIME_ROOT" rev-parse HEAD > "$BRAINBASE_ROLLBACK_STATE_DIR/mcp-runtime.sha"

if test -e "$BRAINBASE_RUNTIME_PIN_FILE"; then
  test -f "$BRAINBASE_RUNTIME_PIN_FILE"
  cp "$BRAINBASE_RUNTIME_PIN_FILE" "$BRAINBASE_ROLLBACK_STATE_DIR/runtime-pin.sha"
  grep -Eq '^[0-9a-f]{40}$' "$BRAINBASE_ROLLBACK_STATE_DIR/runtime-pin.sha"
  printf 'present\n' > "$BRAINBASE_ROLLBACK_STATE_DIR/runtime-pin.state"
else
  printf 'absent\n' > "$BRAINBASE_ROLLBACK_STATE_DIR/runtime-pin.state"
fi
ssh -i "$HOME/.ssh/lightsail-brainbase.pem" ubuntu@176.34.20.239 bash -s -- \
  "${BRAINBASE_LIGHTSAIL_HOTFIX_BACKUP_DIR:-}" <<'REMOTE' \
  > "$BRAINBASE_ROLLBACK_STATE_DIR/lightsail.sha"
set -euo pipefail
HOTFIX_BACKUP_DIR="$1"
cd /home/ubuntu/brainbase
test "$(git rev-parse --is-inside-work-tree)" = true
test "$(git rev-parse --show-toplevel)" = /home/ubuntu/brainbase
test -z "$(git status --porcelain --untracked-files=all)"
BRANCH="$(git symbolic-ref --quiet --short HEAD || true)"
if [[ "$BRANCH" == rollback/production-hotfix-* ]]; then
  test -n "$HOTFIX_BACKUP_DIR"
  test "$(cat "$HOTFIX_BACKUP_DIR/rollback.branch")" = "$BRANCH"
  test "$(cat "$HOTFIX_BACKUP_DIR/rollback.sha")" = "$(git rev-parse HEAD)"
  sha256sum -c "$HOTFIX_BACKUP_DIR/content.sha256" >/dev/null
fi
git rev-parse HEAD
REMOTE

for file in global-hook.sha local-ui.sha mcp-runtime.sha lightsail.sha; do
  grep -Eq '^[0-9a-f]{40}$' "$BRAINBASE_ROLLBACK_STATE_DIR/$file"
done
printf 'Rollback state: %s\n' "$BRAINBASE_ROLLBACK_STATE_DIR"
```

Do not infer one surface SHA from another. The files intentionally preserve all four observed values even when they currently match.

production dirty hotfix reconciliationを実行した場合は、標準Lightsail deployの前に次の一度だけ、復旧専用commitからmerge済み`develop`へ切り替える。これにより履歴分岐を`git merge --ff-only`へ渡さず、退避branchとrollback artifactを保持したまま、標準runbookを`TARGET_SHA`上から開始できる。

```bash
set -euo pipefail
: "${TARGET_SHA:?Set the merged develop SHA}"
: "${BRAINBASE_ROLLBACK_STATE_DIR:?Set the captured rollback directory}"
test -s "$BRAINBASE_ROLLBACK_STATE_DIR/lightsail-hotfix-backup-dir"
ssh -i "$HOME/.ssh/lightsail-brainbase.pem" ubuntu@176.34.20.239 bash -s -- \
  "$TARGET_SHA" \
  "$(cat "$BRAINBASE_ROLLBACK_STATE_DIR/lightsail.sha")" \
  "$(cat "$BRAINBASE_ROLLBACK_STATE_DIR/lightsail-hotfix-backup-dir")" <<'REMOTE'
set -euo pipefail
TARGET_SHA="$1"
ROLLBACK_SHA="$2"
HOTFIX_BACKUP_DIR="$3"
cd /home/ubuntu/brainbase
test -z "$(git status --porcelain --untracked-files=all)"
test "$(git rev-parse HEAD)" = "$ROLLBACK_SHA"
test "$(cat "$HOTFIX_BACKUP_DIR/rollback.sha")" = "$ROLLBACK_SHA"
sha256sum -c "$HOTFIX_BACKUP_DIR/content.sha256" >/dev/null
git fetch origin develop
test "$(git rev-parse origin/develop)" = "$TARGET_SHA"
git cat-file -e "${TARGET_SHA}^{commit}"
git switch --detach "$TARGET_SHA"
test "$(git rev-parse HEAD)" = "$TARGET_SHA"
test -z "$(git status --porcelain --untracked-files=all)"
REMOTE
```

続けて[`deploy-lightsail-production.md`](./deploy-lightsail-production.md)を実行する。開始時点ですでに`TARGET_SHA = origin/develop = HEAD`なので、同runbookの`git merge --ff-only origin/develop`はno-opとなり、依存関係、migration、service restart、readiness、public readbackを正規手順で実行できる。

### Production convergence receipt

マージ済みSHAの4面反映後、設定修復・Ontology・Graph Validateを同じ`BRAINBASE_PRODUCTION_RUN_ID`へ束縛する。以下は秘密値を標準出力やReceiptへ書かず、公開鍵overrideだけが削除され、秘密鍵と`key_id`が同一値のまま維持された場合にだけ進む。途中失敗、HTTP 503、部分取得、未知の応答は非zeroで停止し、成功として扱わない。

```bash
set -euo pipefail
: "${TARGET_SHA:?Set the merged develop SHA}"
: "${BRAINBASE_ROLLBACK_STATE_DIR:?Set the captured rollback directory}"
grep -Eq '^[0-9a-f]{40}$' <<<"$TARGET_SHA"
export BRAINBASE_PRODUCTION_RUN_ID="production-convergence-$(date -u +%Y%m%dT%H%M%SZ)"
export BRAINBASE_PRODUCTION_RUN_DIR="$(mktemp -d "${TMPDIR:-/tmp}/${BRAINBASE_PRODUCTION_RUN_ID}.XXXXXX")"
chmod 700 "$BRAINBASE_PRODUCTION_RUN_DIR"
export BRAINBASE_PRODUCTION_RECEIPT="$BRAINBASE_PRODUCTION_RUN_DIR/production-convergence-receipt.json"
INFISICAL="$HOME/.local/bin/infisical"
INFISICAL_DOMAIN=https://infisical.unson.jp
INFISICAL_PROJECT_ID=ce20541c-02b9-4523-bbe0-49d50b2fcc19

# 1. 変更前後の値は0600の一時ファイルだけへ保存し、Receiptには存在・同一性だけを書く。
"$INFISICAL" export --silent --domain "$INFISICAL_DOMAIN" --env prod --path / \
  --projectId "$INFISICAL_PROJECT_ID" --format json \
  --output-file "$BRAINBASE_PRODUCTION_RUN_DIR/infisical.before.json"
chmod 600 "$BRAINBASE_PRODUCTION_RUN_DIR/infisical.before.json"
BEFORE="$BRAINBASE_PRODUCTION_RUN_DIR/infisical.before.json" \
EVIDENCE="$BRAINBASE_PRODUCTION_RUN_DIR/infisical.evidence.json" node <<'NODE'
const fs = require('node:fs');
const before = JSON.parse(fs.readFileSync(process.env.BEFORE, 'utf8'));
const names = Object.keys(before);
const evidence = {
  public_key_override_present_before: names.includes('ONTOLOGY_PUBLICATION_SIGNING_PUBLIC_KEY'),
  private_key_present_before: names.includes('ONTOLOGY_PUBLICATION_SIGNING_PRIVATE_KEY'),
  key_id_present_before: names.includes('ONTOLOGY_PUBLICATION_SIGNING_KEY_ID')
};
if (!Object.values(evidence).every(Boolean)) process.exit(1);
fs.writeFileSync(process.env.EVIDENCE, JSON.stringify(evidence));
fs.chmodSync(process.env.EVIDENCE, 0o600);
NODE

"$INFISICAL" secrets delete ONTOLOGY_PUBLICATION_SIGNING_PUBLIC_KEY \
  --silent --domain "$INFISICAL_DOMAIN" --env prod --path / \
  --projectId "$INFISICAL_PROJECT_ID" --type shared
"$INFISICAL" export --silent --domain "$INFISICAL_DOMAIN" --env prod --path / \
  --projectId "$INFISICAL_PROJECT_ID" --format json \
  --output-file "$BRAINBASE_PRODUCTION_RUN_DIR/infisical.after.json"
chmod 600 "$BRAINBASE_PRODUCTION_RUN_DIR/infisical.after.json"
BEFORE="$BRAINBASE_PRODUCTION_RUN_DIR/infisical.before.json" \
AFTER="$BRAINBASE_PRODUCTION_RUN_DIR/infisical.after.json" \
EVIDENCE="$BRAINBASE_PRODUCTION_RUN_DIR/infisical.evidence.json" node <<'NODE'
const fs = require('node:fs');
const before = JSON.parse(fs.readFileSync(process.env.BEFORE, 'utf8'));
const after = JSON.parse(fs.readFileSync(process.env.AFTER, 'utf8'));
const evidence = JSON.parse(fs.readFileSync(process.env.EVIDENCE, 'utf8'));
Object.assign(evidence, {
  public_key_override_present_after: Object.hasOwn(after, 'ONTOLOGY_PUBLICATION_SIGNING_PUBLIC_KEY'),
  private_key_preserved: before.ONTOLOGY_PUBLICATION_SIGNING_PRIVATE_KEY === after.ONTOLOGY_PUBLICATION_SIGNING_PRIVATE_KEY,
  key_id_preserved: before.ONTOLOGY_PUBLICATION_SIGNING_KEY_ID === after.ONTOLOGY_PUBLICATION_SIGNING_KEY_ID
});
if (evidence.public_key_override_present_after || !evidence.private_key_preserved || !evidence.key_id_preserved) process.exit(1);
fs.writeFileSync(process.env.EVIDENCE, JSON.stringify(evidence));
NODE

# 2. 修復済みproduction正本をsystemdの既定0600ファイルへ再投影して再起動する。
"$INFISICAL" export --silent --domain "$INFISICAL_DOMAIN" --env prod --path / \
  --projectId "$INFISICAL_PROJECT_ID" --format dotenv \
  --output-file "$BRAINBASE_PRODUCTION_RUN_DIR/.env.infisical"
chmod 600 "$BRAINBASE_PRODUCTION_RUN_DIR/.env.infisical"
REMOTE_ENV="/tmp/${BRAINBASE_PRODUCTION_RUN_ID}.env.infisical"
scp -i "$HOME/.ssh/lightsail-brainbase.pem" \
  "$BRAINBASE_PRODUCTION_RUN_DIR/.env.infisical" \
  "ubuntu@176.34.20.239:$REMOTE_ENV"
ssh -i "$HOME/.ssh/lightsail-brainbase.pem" ubuntu@176.34.20.239 bash -s -- \
  "$REMOTE_ENV" "$TARGET_SHA" <<'REMOTE'
set -euo pipefail
REMOTE_ENV="$1"
TARGET_SHA="$2"
test "$(sudo stat -c '%U:%G:%a' /home/ubuntu/brainbase/.env.infisical)" = root:root:600
sudo install -m 600 -o root -g root "$REMOTE_ENV" /home/ubuntu/brainbase/.env.infisical
rm -f "$REMOTE_ENV"
cd /home/ubuntu/brainbase
test "$(git rev-parse HEAD)" = "$TARGET_SHA"
test -z "$(git status --porcelain --untracked-files=all)"
sudo systemctl restart brainbase-ssot.service
systemctl is-active --quiet brainbase-ssot.service
REMOTE

# 3. 4面を推測せず個別取得する。
HOOK_ROOT="$(cat "$BRAINBASE_ROLLBACK_STATE_DIR/global-hook.root")"
git -C "$HOOK_ROOT" rev-parse HEAD > "$BRAINBASE_PRODUCTION_RUN_DIR/global_hook_sha"
test -z "$(git -C "$HOOK_ROOT" status --porcelain --untracked-files=all)"
curl -fsS http://127.0.0.1:31013/api/version > "$BRAINBASE_PRODUCTION_RUN_DIR/local-ui.version.json"
LOCAL_VERSION="$BRAINBASE_PRODUCTION_RUN_DIR/local-ui.version.json" node -e '
const value=JSON.parse(require("node:fs").readFileSync(process.env.LOCAL_VERSION,"utf8"));
const git=value.runtime?.git;
if(git?.sha!==process.env.TARGET_SHA||git?.dirty!==false)process.exit(1);
process.stdout.write(git.sha+"\n");
' > "$BRAINBASE_PRODUCTION_RUN_DIR/local_ui_sha"
git -C /Users/ksato/workspace/repos/.runtime/brainbase-31013 rev-parse HEAD \
  > "$BRAINBASE_PRODUCTION_RUN_DIR/mcp_runtime_sha"
test -z "$(git -C /Users/ksato/workspace/repos/.runtime/brainbase-31013 status --porcelain --untracked-files=all)"
scripts/run-brainbase-mcp.sh --check
grep -Fx "sha=$TARGET_SHA" /Users/ksato/workspace/var/brainbase-mcp-reconcile.last
launchctl print "gui/$(id -u)/com.brainbase.mcp-brainbase" \
  > "$BRAINBASE_PRODUCTION_RUN_DIR/mcp.launchctl.txt"
grep -Eq 'state = running|pid = [1-9][0-9]*' "$BRAINBASE_PRODUCTION_RUN_DIR/mcp.launchctl.txt"
grep -F '/Users/ksato/workspace/repos/.runtime/brainbase-31013' \
  "$BRAINBASE_PRODUCTION_RUN_DIR/mcp.launchctl.txt"
curl -fsS https://bb.unson.jp/api/version > "$BRAINBASE_PRODUCTION_RUN_DIR/lightsail.version.json"
LIGHTSAIL_VERSION="$BRAINBASE_PRODUCTION_RUN_DIR/lightsail.version.json" node -e '
const value=JSON.parse(require("node:fs").readFileSync(process.env.LIGHTSAIL_VERSION,"utf8"));
const git=value.runtime?.git;
if(git?.sha!==process.env.TARGET_SHA||git?.dirty!==false)process.exit(1);
process.stdout.write(git.sha+"\n");
' > "$BRAINBASE_PRODUCTION_RUN_DIR/lightsail_sha"
for file in global_hook_sha local_ui_sha mcp_runtime_sha lightsail_sha; do
  test "$(cat "$BRAINBASE_PRODUCTION_RUN_DIR/$file")" = "$TARGET_SHA"
done
RUN_DIR="$BRAINBASE_PRODUCTION_RUN_DIR" TARGET_SHA="$TARGET_SHA" \
HOOK_ENTRYPOINT="$(cat "$BRAINBASE_ROLLBACK_STATE_DIR/global-hook.entrypoint")" node <<'NODE' \
  > "$BRAINBASE_PRODUCTION_RUN_DIR/surfaces.evidence.json"
const fs = require('node:fs');
const crypto = require('node:crypto');
const read = (name) => fs.readFileSync(`${process.env.RUN_DIR}/${name}`, 'utf8').trim();
const localVersion = JSON.parse(read('local-ui.version.json'));
const lightsailVersion = JSON.parse(read('lightsail.version.json'));
const hookBytes = fs.readFileSync(process.env.HOOK_ENTRYPOINT);
const sha = (name) => read(name);
const surfaces = {
  global_hook: {
    checkout_sha: sha('global_hook_sha'), dirty: false,
    entrypoint_sha256: crypto.createHash('sha256').update(hookBytes).digest('hex'),
    readiness: 'entrypoint_readback_passed'
  },
  local_ui: {
    checkout_sha: sha('local_ui_sha'), process_sha: localVersion.runtime?.git?.sha,
    dirty: localVersion.runtime?.git?.dirty, readiness: 'version_readback_passed'
  },
  mcp_runtime: {
    checkout_sha: sha('mcp_runtime_sha'), process_sha: sha('mcp_runtime_sha'), dirty: false,
    readiness: 'launcher_check_and_launchctl_running'
  },
  lightsail: {
    checkout_sha: sha('lightsail_sha'), process_sha: lightsailVersion.runtime?.git?.sha,
    dirty: lightsailVersion.runtime?.git?.dirty, readiness: 'public_version_readback_passed'
  }
};
for (const value of Object.values(surfaces)) {
  if (value.checkout_sha !== process.env.TARGET_SHA || value.dirty !== false
    || !value.readiness || ('process_sha' in value && value.process_sha !== process.env.TARGET_SHA)) process.exit(1);
}
process.stdout.write(JSON.stringify(surfaces));
NODE

# 4. Git信頼ストア、production Ontology、Graph全体検証を同じrunへ保存する。
npm run ontology:verify > "$BRAINBASE_PRODUCTION_RUN_DIR/ontology.verify.txt"
TOKEN="$(jq -er .access_token "$HOME/.brainbase/tokens.json")"
curl -fsS -H "Authorization: Bearer $TOKEN" \
  https://bb.unson.jp/api/info/ontology/releases/1.1.0 \
  > "$BRAINBASE_PRODUCTION_RUN_DIR/ontology.production.json"
ONTOLOGY="$BRAINBASE_PRODUCTION_RUN_DIR/ontology.production.json" \
INFISICAL_EVIDENCE="$BRAINBASE_PRODUCTION_RUN_DIR/infisical.evidence.json" node <<'NODE' \
  > "$BRAINBASE_PRODUCTION_RUN_DIR/ontology.evidence.json"
const fs = require('node:fs');
const production = JSON.parse(fs.readFileSync(process.env.ONTOLOGY, 'utf8'));
const index = JSON.parse(fs.readFileSync('config/ontology/index.json', 'utf8'));
const entry = index.releases.find((item) => item.version === '1.1.0');
const receipt = JSON.parse(fs.readFileSync(`config/ontology/${entry.receipt_path}`, 'utf8'));
const infisical = JSON.parse(fs.readFileSync(process.env.INFISICAL_EVIDENCE, 'utf8'));
const evidence = {
  version: production.version,
  repository_digest: entry.content_digest,
  production_digest: production.digest,
  key_id: receipt.key_id,
  trust_source: 'git_trust_store',
  signature_verification: 'verified',
  public_key_override_present: infisical.public_key_override_present_after
};
if (evidence.version !== '1.1.0' || evidence.repository_digest !== evidence.production_digest
  || !evidence.key_id || evidence.public_key_override_present !== false) process.exit(1);
process.stdout.write(JSON.stringify(evidence));
NODE
GRAPH_BODY="$BRAINBASE_PRODUCTION_RUN_DIR/graph.validate.json"
GRAPH_STATUS="$(curl -sS -o "$GRAPH_BODY" -w '%{http_code}' \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -X POST https://bb.unson.jp/api/info/graph/maintenance/validate \
  --data '{"project_code":"brainbase","strict_collection":true}')"
test "$GRAPH_STATUS" = 200
GRAPH_BODY="$GRAPH_BODY" GRAPH_STATUS="$GRAPH_STATUS" node <<'NODE' \
  > "$BRAINBASE_PRODUCTION_RUN_DIR/graph.evidence.json"
const fs = require('node:fs');
const graph = JSON.parse(fs.readFileSync(process.env.GRAPH_BODY, 'utf8'));
const suppressionSummary = graph.suppression_summary || {};
const evidence = {
  graph_http_status: Number(process.env.GRAPH_STATUS),
  strict_collection: graph.validation_scope?.strict_collection === true,
  collection_complete: graph.collection_complete === true,
  snapshot_hash: typeof graph.snapshot_hash === 'string' ? graph.snapshot_hash : null,
  structural_violation_count: Array.isArray(graph.issues) ? graph.issues.length : null,
  ontology_violation_count: Array.isArray(graph.ontology?.violations) ? graph.ontology.violations.length : null,
  suppressed_edge_count: Number.isInteger(suppressionSummary.edge_count) ? suppressionSummary.edge_count : 0,
  suppression_reasons: suppressionSummary.reasons && typeof suppressionSummary.reasons === 'object'
    ? suppressionSummary.reasons
    : {},
  graph_valid: graph.valid === true
};
if (evidence.graph_http_status !== 200 || !evidence.strict_collection || !evidence.collection_complete
  || !/^sha256:[a-f0-9]{64}$/.test(evidence.snapshot_hash || '')
  || evidence.structural_violation_count !== 0 || evidence.ontology_violation_count !== 0
  || evidence.suppressed_edge_count !== 0
  || !evidence.graph_valid) process.exit(1);
process.stdout.write(JSON.stringify(evidence));
NODE

# 5. Receiptは秘密値を含まず、同一run IDと統合SHAへ固定する。
RUN_DIR="$BRAINBASE_PRODUCTION_RUN_DIR" RUN_ID="$BRAINBASE_PRODUCTION_RUN_ID" \
TARGET_SHA="$TARGET_SHA" RECEIPT="$BRAINBASE_PRODUCTION_RECEIPT" node <<'NODE'
const fs = require('node:fs');
const read = (name) => fs.readFileSync(`${process.env.RUN_DIR}/${name}`, 'utf8').trim();
const receipt = {
  schema_version: 'brainbase.production-convergence.v1',
  run_id: process.env.RUN_ID,
  target_sha: process.env.TARGET_SHA,
  infisical: JSON.parse(read('infisical.evidence.json')),
  surfaces: JSON.parse(read('surfaces.evidence.json')),
  ontology: JSON.parse(read('ontology.evidence.json')),
  graph: JSON.parse(read('graph.evidence.json')),
  status: 'passed'
};
fs.writeFileSync(process.env.RECEIPT, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
NODE
chmod 600 "$BRAINBASE_PRODUCTION_RECEIPT"
printf 'Production convergence receipt: %s\n' "$BRAINBASE_PRODUCTION_RECEIPT"
```

`production-convergence-receipt.json`の`status=passed`は、同じrunで全判定を通過した場合だけ作られる。作成前に停止した場合は、Infisicalの変更有無とサービス状態を読み戻し、推測で再実行せず、保存済みの`infisical.before.json`と`BRAINBASE_ROLLBACK_STATE_DIR`から復旧境界を確定する。

### Verification

```bash
scripts/run-brainbase-mcp.sh --check
npm run test:judgment-resolution
npm --prefix mcp/brainbase run typecheck
npm run typecheck
cmp -s CLAUDE.md AGENTS.md
npm run check:judgment-hook-readiness -- --cwd "$BRAINBASE_CONTRACT_ROOT"
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

Use the captured directory; do not guess a previous tag or delete any episode journals. The order below pins the disposable local UI/MCP runtime to the captured known-good commit, restores Lightsail, and finally restores the exact Hook configuration. The source checkout is identity-checked but never switched, reset, cleaned, or stashed.

```bash
set -euo pipefail
: "${BRAINBASE_ROLLBACK_STATE_DIR:?Set this to the captured rollback directory}"
export BRAINBASE_SOURCE_ROOT=/Users/ksato/workspace/repos/brainbase
export BRAINBASE_UI_RUNTIME_ROOT=/Users/ksato/workspace/repos/.runtime/brainbase-31013
export BRAINBASE_MCP_RUNTIME_ROOT="$BRAINBASE_UI_RUNTIME_ROOT"
export BRAINBASE_RUNTIME_PIN_FILE=/Users/ksato/workspace/var/brainbase-runtime-pinned.sha
for file in hooks.json hooks.sha256 global-hook.entrypoint global-hook.root global-hook.sha local-ui.sha mcp-runtime.sha lightsail.sha runtime-pin.state; do
  test -s "$BRAINBASE_ROLLBACK_STATE_DIR/$file"
done
require_git_root() {
  local root="$1" actual
  test -d "$root"
  test -d "$root/.git" -o -f "$root/.git"
  test "$(git -C "$root" rev-parse --is-inside-work-tree)" = true
  actual="$(git -C "$root" rev-parse --show-toplevel)"
  test "$(cd "$actual" && pwd -P)" = "$(cd "$root" && pwd -P)"
  git -C "$root" rev-parse HEAD >/dev/null
}
require_clean_tracked_root() {
  local root="$1" status
  require_git_root "$root"
  status="$(git -C "$root" status --porcelain --untracked-files=no)"
  test -z "$status"
}
require_git_root "$BRAINBASE_SOURCE_ROOT"
require_clean_tracked_root "$BRAINBASE_UI_RUNTIME_ROOT"
BRAINBASE_HOOK_ENTRYPOINT="$(cat "$BRAINBASE_ROLLBACK_STATE_DIR/global-hook.entrypoint")"
BRAINBASE_HOOK_ROOT="$(cat "$BRAINBASE_ROLLBACK_STATE_DIR/global-hook.root")"
test -f "$BRAINBASE_HOOK_ENTRYPOINT"
require_clean_tracked_root "$BRAINBASE_HOOK_ROOT"
test "$(cd "$(git -C "$(dirname "$BRAINBASE_HOOK_ENTRYPOINT")" rev-parse --show-toplevel)" && pwd -P)" = "$(cd "$BRAINBASE_HOOK_ROOT" && pwd -P)"

# 1. Pin the shared disposable :31013 UI/MCP runtime. The pin is installed
# atomically before restart, so both launchd start and the 60-second updater
# keep the known-good SHA instead of reapplying a failed origin/develop.
LOCAL_ROLLBACK_SHA="$(cat "$BRAINBASE_ROLLBACK_STATE_DIR/local-ui.sha")"
MCP_ROLLBACK_SHA="$(cat "$BRAINBASE_ROLLBACK_STATE_DIR/mcp-runtime.sha")"
grep -Eq '^[0-9a-f]{40}$' <<<"$LOCAL_ROLLBACK_SHA"
test "$MCP_ROLLBACK_SHA" = "$LOCAL_ROLLBACK_SHA"
git -C "$BRAINBASE_SOURCE_ROOT" cat-file -e "${LOCAL_ROLLBACK_SHA}^{commit}"
PIN_TMP="$(mktemp "${BRAINBASE_RUNTIME_PIN_FILE}.XXXXXX")"
chmod 600 "$PIN_TMP"
printf '%s\n' "$LOCAL_ROLLBACK_SHA" > "$PIN_TMP"
mv "$PIN_TMP" "$BRAINBASE_RUNTIME_PIN_FILE"
READINESS_HELPER="$BRAINBASE_SOURCE_ROOT/scripts/launchd/brainbase-runtime-readiness.sh"
test -r "$READINESS_HELPER"
source "$READINESS_HELPER"
RUNTIME_CONNECT_TIMEOUT_SECONDS="${BRAINBASE_RUNTIME_READINESS_CONNECT_TIMEOUT_SECONDS:-5}"
RUNTIME_MAX_TIMEOUT_SECONDS="${BRAINBASE_RUNTIME_READINESS_MAX_TIMEOUT_SECONDS:-10}"
brainbase_runtime_readiness_validate_positive_seconds "$RUNTIME_CONNECT_TIMEOUT_SECONDS" 'connect timeout'
brainbase_runtime_readiness_validate_positive_seconds "$RUNTIME_MAX_TIMEOUT_SECONDS" 'maximum request time'
launchctl kickstart -k "gui/$(id -u)/com.brainbase.ui"
brainbase_wait_for_runtime_ready \
  "$BRAINBASE_UI_RUNTIME_ROOT" \
  "$LOCAL_ROLLBACK_SHA" \
  http://127.0.0.1:31013/api/version \
  "${BRAINBASE_RUNTIME_READINESS_ATTEMPTS:-30}" \
  "${BRAINBASE_RUNTIME_READINESS_DELAY_SECONDS:-2}" \
  "$RUNTIME_CONNECT_TIMEOUT_SECONDS" \
  "$RUNTIME_MAX_TIMEOUT_SECONDS"
(cd "$BRAINBASE_MCP_RUNTIME_ROOT" && scripts/reconcile-brainbase-mcp-runtime.sh "$MCP_ROLLBACK_SHA")
(cd "$BRAINBASE_MCP_RUNTIME_ROOT" && scripts/run-brainbase-mcp.sh --check)
launchctl print "gui/$(id -u)/com.brainbase.mcp-brainbase" | grep -q 'state = running'

# 2. Restore Lightsail, reinstall dependencies only when its manifest changed,
# and prove both the instance and public proxy report the captured SHA.
LIGHTSAIL_CONNECT_TIMEOUT_SECONDS="${BRAINBASE_LIGHTSAIL_READINESS_CONNECT_TIMEOUT_SECONDS:-5}"
LIGHTSAIL_MAX_TIMEOUT_SECONDS="${BRAINBASE_LIGHTSAIL_READINESS_MAX_TIMEOUT_SECONDS:-10}"
LIGHTSAIL_HOTFIX_BACKUP_DIR=""
if test -s "$BRAINBASE_ROLLBACK_STATE_DIR/lightsail-hotfix-backup-dir"; then
  LIGHTSAIL_HOTFIX_BACKUP_DIR="$(cat "$BRAINBASE_ROLLBACK_STATE_DIR/lightsail-hotfix-backup-dir")"
fi
if ! [[ "$LIGHTSAIL_CONNECT_TIMEOUT_SECONDS" =~ ^(0\.[0-9]*[1-9][0-9]*|[1-9][0-9]*(\.[0-9]+)?)$ ]]; then
  printf '[brainbase-runtime] Lightsail connect timeout must be a finite positive number\n' >&2
  exit 2
fi
if ! [[ "$LIGHTSAIL_MAX_TIMEOUT_SECONDS" =~ ^(0\.[0-9]*[1-9][0-9]*|[1-9][0-9]*(\.[0-9]+)?)$ ]]; then
  printf '[brainbase-runtime] Lightsail maximum request time must be a finite positive number\n' >&2
  exit 2
fi
ssh -i "$HOME/.ssh/lightsail-brainbase.pem" ubuntu@176.34.20.239 bash -s -- \
  "$(cat "$BRAINBASE_ROLLBACK_STATE_DIR/lightsail.sha")" \
  "${BRAINBASE_LIGHTSAIL_READINESS_ATTEMPTS:-30}" \
  "${BRAINBASE_LIGHTSAIL_READINESS_DELAY_SECONDS:-2}" \
  "$LIGHTSAIL_CONNECT_TIMEOUT_SECONDS" \
  "$LIGHTSAIL_MAX_TIMEOUT_SECONDS" \
  "$LIGHTSAIL_HOTFIX_BACKUP_DIR" <<'REMOTE'
set -euo pipefail
ROLLBACK_SHA="$1"
MAX_ATTEMPTS="$2"
DELAY_SECONDS="$3"
CONNECT_TIMEOUT_SECONDS="$4"
MAX_TIMEOUT_SECONDS="$5"
HOTFIX_BACKUP_DIR="$6"
[[ "$MAX_ATTEMPTS" =~ ^[1-9][0-9]*$ ]]
[[ "$DELAY_SECONDS" =~ ^[0-9]+([.][0-9]+)?$ ]]
if ! [[ "$CONNECT_TIMEOUT_SECONDS" =~ ^(0\.[0-9]*[1-9][0-9]*|[1-9][0-9]*(\.[0-9]+)?)$ ]]; then
  printf '[brainbase-runtime] Lightsail connect timeout must be a finite positive number\n' >&2
  exit 2
fi
if ! [[ "$MAX_TIMEOUT_SECONDS" =~ ^(0\.[0-9]*[1-9][0-9]*|[1-9][0-9]*(\.[0-9]+)?)$ ]]; then
  printf '[brainbase-runtime] Lightsail maximum request time must be a finite positive number\n' >&2
  exit 2
fi
cd /home/ubuntu/brainbase
test "$(git rev-parse --is-inside-work-tree)" = true
test "$(git rev-parse --show-toplevel)" = /home/ubuntu/brainbase
status="$(git status --porcelain)"
test -z "$status"
FAILED_SHA="$(git rev-parse HEAD)"
git cat-file -e "${ROLLBACK_SHA}^{commit}"
git switch --detach "$ROLLBACK_SHA"
if ! git diff --quiet "$ROLLBACK_SHA" "$FAILED_SHA" -- package.json package-lock.json; then
  npm ci --omit=dev
fi
sudo systemctl restart brainbase-ssot.service
if test -n "$HOTFIX_BACKUP_DIR"; then
  test "$(cat "$HOTFIX_BACKUP_DIR/rollback.sha")" = "$ROLLBACK_SHA"
  sha256sum -c "$HOTFIX_BACKUP_DIR/content.sha256"
fi
local_ready=0
for ((attempt=1; attempt<=MAX_ATTEMPTS; attempt+=1)); do
  if curl -fsS \
    --connect-timeout "$CONNECT_TIMEOUT_SECONDS" \
    --max-time "$MAX_TIMEOUT_SECONDS" \
    -- http://127.0.0.1:55123/api/version | TARGET_SHA="$ROLLBACK_SHA" node -e '
const value=JSON.parse(require("node:fs").readFileSync(0,"utf8"));
const git=value.runtime?.git;
if (git?.sha!==process.env.TARGET_SHA || git?.dirty!==false) process.exit(1);
'; then
    local_ready=1
    break
  fi
  if (( attempt < MAX_ATTEMPTS )); then sleep "$DELAY_SECONDS"; fi
done
if (( local_ready != 1 )); then
  printf '[brainbase-runtime] Lightsail local readiness timed out after %s attempts\n' "$MAX_ATTEMPTS" >&2
  exit 1
fi
REMOTE
TARGET_SHA="$(cat "$BRAINBASE_ROLLBACK_STATE_DIR/lightsail.sha")"
PUBLIC_ATTEMPTS="${BRAINBASE_LIGHTSAIL_READINESS_ATTEMPTS:-30}"
PUBLIC_DELAY_SECONDS="${BRAINBASE_LIGHTSAIL_READINESS_DELAY_SECONDS:-2}"
PUBLIC_CONNECT_TIMEOUT_SECONDS="$LIGHTSAIL_CONNECT_TIMEOUT_SECONDS"
PUBLIC_MAX_TIMEOUT_SECONDS="$LIGHTSAIL_MAX_TIMEOUT_SECONDS"
public_ready=0
for ((attempt=1; attempt<=PUBLIC_ATTEMPTS; attempt+=1)); do
  if curl -fsS \
    --connect-timeout "$PUBLIC_CONNECT_TIMEOUT_SECONDS" \
    --max-time "$PUBLIC_MAX_TIMEOUT_SECONDS" \
    -- https://bb.unson.jp/api/version | TARGET_SHA="$TARGET_SHA" node -e '
const value=JSON.parse(require("node:fs").readFileSync(0,"utf8"));
const git=value.runtime?.git;
if (git?.sha!==process.env.TARGET_SHA || git?.dirty!==false) process.exit(1);
'; then
    public_ready=1
    break
  fi
  if (( attempt < PUBLIC_ATTEMPTS )); then sleep "$PUBLIC_DELAY_SECONDS"; fi
done
if (( public_ready != 1 )); then
  printf '[brainbase-runtime] Lightsail public readiness timed out after %s attempts\n' "$PUBLIC_ATTEMPTS" >&2
  exit 1
fi

# 3. Restore the exact previous Hook config last. The captured clean Hook
# checkout was never mutated, so restoring hooks.json is sufficient.
install -m 600 "$BRAINBASE_ROLLBACK_STATE_DIR/hooks.json" "$HOME/.codex/hooks.json"
(cd "$BRAINBASE_ROLLBACK_STATE_DIR" && shasum -a 256 -c hooks.sha256)
test "$(git -C "$BRAINBASE_HOOK_ROOT" rev-parse HEAD)" = "$(cat "$BRAINBASE_ROLLBACK_STATE_DIR/global-hook.sha")"
require_clean_tracked_root "$BRAINBASE_HOOK_ROOT"
require_git_root "$BRAINBASE_SOURCE_ROOT"
(cd "$BRAINBASE_MCP_RUNTIME_ROOT" && scripts/run-brainbase-mcp.sh --check)
npm --prefix "$BRAINBASE_HOOK_ROOT" run check:judgment-hook-readiness -- --cwd "$BRAINBASE_HOOK_ROOT"
curl -fsS \
  --connect-timeout "$LIGHTSAIL_CONNECT_TIMEOUT_SECONDS" \
  --max-time "$LIGHTSAIL_MAX_TIMEOUT_SECONDS" \
  -o /dev/null \
  -- https://bb.unson.jp/api/health
```

Keep the runtime pin in place after rollback; removing it would allow the periodic updater to reapply the failed `origin/develop`. Clear it only as part of a separately verified forward deployment. After these commands, run one fresh Codex turn and the live transcript verification above. Until `UserPromptSubmit` opens a valid episode and the final transcript shows the exact audit prefix, report the rollback as incomplete. Never remove `~/.codex/var/judgment-resolver`; its existing episode/event/final files remain audit evidence.

## Autonomy Gate rollout

Stop finalization can evaluate human-directed approval or choice questions before the existing audit repair.

- Default: disabled (`BRAINBASE_JUDGMENT_AUTONOMY_MODE=off` or unset).
- Canary: set `BRAINBASE_JUDGMENT_AUTONOMY_MODE=canary` and a comma-separated `BRAINBASE_JUDGMENT_AUTONOMY_CANARY_PROJECTS`.
- Full enablement: `BRAINBASE_JUDGMENT_AUTONOMY_MODE=enabled`.
- Rollback: remove the variables or set the mode to `off`; existing episode and final receipt schemas remain valid.

The Gate preserves a clarification selected by the accepted route receipt and fails closed for destructive production changes, authority or secret gaps, sensitive-data transfer, and financial or legal commitments. A routine or semantically resolvable question creates one immutable `brainbase-judgment-autonomy-receipt-v1` and returns `decision:block` so the same Codex turn continues. Repeating the same unnecessary escalation fails with `judgment_autonomy_continuation_exhausted`.

Runtime 2.4以降の実装・操作turnでは、日本語の質問表現、「完了しました」という語、回答内HTMLコメントを判定材料にしない。モデルは最後のtool callとして`brainbase_judgment_state_record`を1回実行し、PostToolUse Hostが同一episodeのjournalへ状態を保存する。Stopはjournalのschema・許可理由・event順序を検証し、`pending`や古い状態を差し戻す。`completed`は状態eventより前に成功した実行証跡がある場合だけ受理する。状態の欠落・不正形式は旧判定へ戻さずfail-closedとする。Runtime 2.3だけは回答内marker、Runtime 2.2以前は自然文検出をrollout互換として使う。これは実行証跡の存在を検証する契約であり、`content_verification_status: not_evaluated`の通り、変更内容の意味的な正しさを自動証明するものではない。

Autonomy continuation and owner-audit repair have separate bounded retries. Resolver Provider decisions, when injected by a Host adapter, must be bound to the case ID, include non-empty Brainbase basis, and cannot expand action authority.
