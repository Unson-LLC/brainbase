# Judgment resolution runbook

Use `brainbase_judgment_resolve` once before answering or acting on each Brainbase-managed turn. The call resolves which branches are relevant; it does not require every judgment stage on every turn.

## Prepare the proposal

Provide the user's request and a host-generated classification proposal:

- `turn_id`: unique host turn identifier
- `project_code`: include when the turn belongs to a project
- `conversation_context`: for a follow-up utterance, include only the prior text needed to resolve its meaning plus the exact `source_turn_ids`; omit it for self-contained turns
- `intent`: answer, investigate, diagnose, design, implement, review, or operate
- `domains`: the smallest server-matcher-supported domain set; conceptual similarity alone is not support
- `action_kind` and `risk`: never understate the intended effect
- `signals`: only values whose runtime-manifest matcher occurs in the request or explicitly supplied conversation context
- `knowledge_context`: required for a knowledge domain

The proposal is untrusted routing input. Do not provide DAG IDs, policy IDs, active nodes, runtime version, host binding, or assurance.

Treat a verb mention and an action request separately. For example, `人間が全件マージできる` is an authority/enforcement constraint, not a merge request; `マージして` is a write request. Likewise, `PR採用` is engineering adoption, while explicit human-hiring phrases belong to the organization domain.

Treat a historical reference and a retrieval request separately. `Story履歴を踏まえて判断する` stays in the active engineering judgment unless the turn also asks to search, look up, or retrieve knowledge; bare words such as `履歴` or `事実上` do not select the knowledge branch.

## Execute the resolved subgraph

1. Call `brainbase_judgment_resolve`.
2. Verify `management_status=managed` and retain the receipt with the current turn.
3. Confirm `context_digest` matches whether conversation context was supplied, then follow only `active_nodes` and `active_edges` using the one-to-one `active_node_definitions[].instruction`; all incoming edges are conjunctive dependencies, and node IDs must not be reinterpreted through an independent prompt library.
4. If `required_capabilities` contains `knowledge.resolve`, call `brainbase_knowledge_resolve` and keep its separate retrieval-routing receipt.
5. If status is `needs_classification` or `needs_policy_resolution`, resolve the listed `unresolved` items before proceeding.
6. Perform any independent authorization, approval, and enforcement checks required by the eventual action.

For `cumulative_effect` or `complexity_growth`, execute `controller-scope` before proposing another Story: read recent Story history, cumulative complexity, and external outcomes, then select normal development or simplification once. Keep candidate generation parallel inside the selected mode; adoption must not choose the mode again. Use existing Story/PR/merge checks to verify the selected mode and prevent manual all-PR merge bypass. The common merge node is only a receipt join, so do not introduce a PR fan-in subsystem.

For `threshold_proposal`, missing evidence or measurability remains unresolved. Never replace an unsupported threshold with another number, ratio, count, duration, budget, or inequality.

## Failure semantics

- Tool unavailable, API failure, binding rejection, request mismatch, or invalid/missing receipt becomes visibly `unmanaged`; never flatten it into a normal result.
- In `unmanaged`, read-only explanation or diagnosis may continue with an explicit warning, but write/external actions stop.
- A receipt proves the selected judgment path and policy version. It does not prove Knowledge retrieval, external outcome, human approval, or action authorization.

## Runtime changes

When changing the manifest, increment `runtime_version` and append the new version/digest pair to `config/judgment-runtime-manifest-lock.json`. Never rewrite or remove an earlier lock entry. Run the cross-runtime digest and host-binding tests before publication.

## Codex global turn entry

Codex is the primary host. Register `scripts/codex-hooks/judgment-resolver-entry.sh` in the user-level `~/.codex/hooks.json` `UserPromptSubmit` list so every Codex turn receives the mandatory resolver contract, regardless of the current repository. Preserve existing user hooks. The command must use the canonical deployed path:

```text
bash /Users/ksato/workspace/code/brainbase/scripts/codex-hooks/judgment-resolver-entry.sh
```

The hook injects the Codex-owned `turn_id`; session and cwd are host context, not resolver arguments. The call must follow the MCP schema exactly: `classification_proposal` is one nested object, every classification value must be one of the schema's lowercase enum tokens, and numeric confidence, invented domain/signal values, `session_id`, `cwd`, and flat `proposed_*` fields are forbidden. The hook reads the deployed runtime manifest and injects its domain/signal matcher map, so the model proposes only classifications that have an explicit matcher in the current request or supplied conversation context; it must not broaden `personal_judgment` or `organization` from generic ideas such as judgment, preference, approval, or authority. The server still owns reconciliation and fails closed when the proposal lacks matcher support. Negated safety language is classified by requested effect, so “do not write or act externally” does not itself raise `action_kind` to `write` or `external`. This does not run every judgment stage: the returned receipt selects only the context-relevant active DAG. A hook instruction is host-contract enforcement, not proof that the stateless server observed an omitted call; missing tool or receipt remains visibly `unmanaged` and blocks write/external action.

## Binding secret provisioning and rotation

- Provision the same high-entropy `BRAINBASE_JUDGMENT_BINDING_SECRET` to the Brainbase API runtime and the Brainbase MCP Infisical path. Never log or return it.
- Keep `BRAINBASE_JUDGMENT_ADAPTER_ID=brainbase-mcp` and `BRAINBASE_JUDGMENT_ADAPTER_VERSION=1` aligned with the manifest registry. A version change requires a manifest/runtime version update.
- `scripts/run-brainbase-mcp.sh --check` must pass before declaring the MCP managed. It fails closed when the binding secret is missing, then sends a signed read-only probe to `/api/judgment/resolve` and accepts only a request-bound `managed` receipt. This detects API/MCP secret mismatch before the first user turn.
- The launcher resolves one API URL in the order `BRAINBASE_GRAPH_API_URL`, `BRAINBASE_API_URL`, then `BRAINBASE_API_BASE_URL`, exports it as `BRAINBASE_RESOLVED_API_URL`, and uses that exact value for the task preflight, Judgment preflight, and production MCP dispatcher. Do not configure different endpoints for those paths.
- Rotate by deploying a manifest/version that accepts the intended adapter, replacing the API and MCP secret in one controlled window, restarting both runtimes, and verifying a signed receipt. During mismatch, report `unmanaged` and block write/external action.

### Initial release order

1. Generate one high-entropy secret of at least 32 characters without printing it to logs. Provision that exact value to both the Brainbase API runtime and the `brainbase-mcp` Infisical target before changing either runtime.
2. Run the Infisical target readiness check and confirm that `BRAINBASE_JUDGMENT_BINDING_SECRET` is present alongside `BRAINBASE_API_URL` and `BRAINBASE_TASK_API_TOKEN`. Check key presence only; never read the value into an artifact.
3. Deploy the API at the intended commit SHA. Confirm the deployed SHA and that authenticated requests can reach `/api/judgment/resolve`; an unsigned request must still be rejected.
4. From the same commit SHA intended for the MCP runtime, run `scripts/run-brainbase-mcp.sh --check` **before mutating the currently runnable MCP checkout**. The automated reconciler runs this candidate launcher from the UI checkout first and only fast-forwards/builds the MCP runtime after both the task API preflight and the signed Judgment binding preflight succeed against the deployed API.
5. Update and restart the MCP runtime, then verify the reconcile receipt and running MCP SHA match the intended commit. Do not declare the host managed from deployment success alone; retain the successful signed preflight evidence.

### Rollback

1. Stop the rollout before restarting additional MCP processes if the API deployment, signed preflight, reconcile receipt, or runtime SHA check fails.
2. Restore the last known-good API and MCP commit SHAs as a pair. Do not roll back only one side while leaving an incompatible adapter or manifest active.
3. Restore the previous shared binding secret to both runtimes if the failed release rotated it. Never retain a different secret on one side.
4. Run `scripts/run-brainbase-mcp.sh --check` against the restored API before restarting MCP. Then reconcile the MCP runtime and confirm both the reconcile receipt and running SHA report the restored commit.
5. Until the restored signed preflight succeeds, report the Judgment path as unmanaged and keep write/external actions stopped.
