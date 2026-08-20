---
spec_id: spec-j0-judgment-dag-core-contract
story_id: story-j0-judgment-dag-core-contract
status: accepted
architecture: docs/architecture/judgment-dag-core.md
source_lock: contracts/judgment-dag/source-lock.json
---

# Accepted Spec: J0 Judgment DAG core contract

## Contract

`JudgmentDAG` contains immutable-compatible nodes and edges. Node type/layer compatibility is fixed as `observation->context`, `judgment/decision->judgment`, `resource->resource`, `execution/outcome->execution`, and `evaluation->evaluation`. Validation is a pure preflight operation and returns a deterministic topological order with node-ID ascending tie-breaks.

## Acceptance/test references

| ID | Requirement | Test/source reference |
|---|---|---|
| AC-001 | Typed contract and compatibility map | `src/judgment-dag-core.ts`, `src/judgment-dag.ts` |
| AC-002 | Missing/cycle/reverse-layer/impersonation rejection | `tests/judgment-dag-core.test.ts` |
| AC-003 | Recursive metadata validation | `tests/judgment-dag-core.test.ts` |
| AC-004 | Stable order and immutable fixtures | `tests/judgment-dag-core.test.ts` |
| AC-005 | Machine artifacts and package consumer contract | `tests/judgment-dag-public-contract.test.ts`, `tests/npm-consumer-smoke.integration.test.ts` |

The package root remains the MCP startup entrypoint. Only the `./judgment-dag` subpath is side-effect free.

## Explicit non-goals

This slice does not implement or verify runner execution, artifact storage, execution logs, replay, evaluation mutation, or Execution/Evaluation mutation protection. Those are J0-2 follow-up scope and must not be inferred from this contract or its tests.
