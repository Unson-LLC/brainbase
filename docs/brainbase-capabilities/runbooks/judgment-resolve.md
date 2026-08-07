# Judgment resolution runbook

Use `brainbase_judgment_resolve` once before answering or acting on each Brainbase-managed turn. The call resolves which branches are relevant; it does not require every judgment stage on every turn.

## Prepare the proposal

Provide the user's request and a host-generated classification proposal:

- `turn_id`: unique host turn identifier
- `project_code`: include when the turn belongs to a project
- `conversation_context`: for a follow-up utterance, include only the prior text needed to resolve its meaning plus the exact `source_turn_ids`; omit it for self-contained turns
- `intent`: answer, investigate, diagnose, design, implement, review, or operate
- `domains`: the smallest plausible domain set
- `action_kind` and `risk`: never understate the intended effect
- `signals`: only context-supported cumulative, complexity, threshold, parallelism, authority, framing, or external-outcome signals
- `knowledge_context`: required for a knowledge domain

The proposal is untrusted routing input. Do not provide DAG IDs, policy IDs, active nodes, runtime version, host binding, or assurance.

## Execute the resolved subgraph

1. Call `brainbase_judgment_resolve`.
2. Verify `management_status=managed` and retain the receipt with the current turn.
3. Confirm `context_digest` matches whether conversation context was supplied, then follow only `active_nodes` and `active_edges` using the one-to-one `active_node_definitions[].instruction`; do not execute node IDs from an independent prompt library.
4. If `required_capabilities` contains `knowledge.resolve`, call `brainbase_knowledge_resolve` and keep its separate retrieval-routing receipt.
5. If status is `needs_classification` or `needs_policy_resolution`, resolve the listed `unresolved` items before proceeding.
6. Perform any independent authorization, approval, and enforcement checks required by the eventual action.

## Failure semantics

- Tool unavailable, API failure, binding rejection, request mismatch, or invalid/missing receipt becomes visibly `unmanaged`; never flatten it into a normal result.
- In `unmanaged`, read-only explanation or diagnosis may continue with an explicit warning, but write/external actions stop.
- A receipt proves the selected judgment path and policy version. It does not prove Knowledge retrieval, external outcome, human approval, or action authorization.

## Runtime changes

When changing the manifest, increment `runtime_version` and append the new version/digest pair to `config/judgment-runtime-manifest-lock.json`. Never rewrite or remove an earlier lock entry. Run the cross-runtime digest and host-binding tests before publication.

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
