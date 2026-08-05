# Round 1 actual-host trace

Surface: MCP Inspector 2.0.0 connected to the repository-built `brainbase-mcp` stdio server.

Evaluator: Codex acting through four synthetic beginner lenses. These are structured review lenses, not human participants. No quotes, human timings, physical-device evidence, or assistive-technology evidence were collected.

## Shared task trace

1. Opened `brainbase_onboarding_start` in the actual host UI.
2. Started a run with Drive `ready` and Gmail `waiting_for_authorization`.
3. Confirmed the result preserved both source states and exposed `runId`.
4. Opened `brainbase_onboarding_ingest`, submitted one inferred Decision candidate, and received `candidates_ready`.
5. Tried to approve the inferred candidate in `brainbase_onboarding_review`.
6. Confirmed the host error contained only `inferred candidates cannot be approved`; it did not contain the recovery action.
7. Opened `brainbase_onboarding_first_value`.
8. Confirmed MCP Inspector rendered no input fields because the public JSON Schema used a top-level `oneOf`; only `Execute Tool` was available.
9. Opened `get_ontology`.
10. Confirmed the result began directly with the full versioned contract and exposed no beginner map before the raw ontology.

## Evidence boundary

- Collected: actual host UI, browser DOM snapshot, screenshots, MCP request history.
- Not collected: human participant observation, real device, screen reader, task timing.
