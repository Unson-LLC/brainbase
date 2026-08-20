---
spec_id: spec-j0-judgment-dag-core-contract
story_id: story-j0-judgment-dag-core-contract
status: accepted
architecture: docs/architecture/judgment-dag-core.md
source_lock: contracts/judgment-dag/source-lock.json
canonical_story: docs/management/stories/active/story-j0-judgment-dag-core-contract.md
---

# Accepted Spec: J0 Judgment DAG core contract

## Contract

`JudgmentDAG` contains immutable-compatible nodes and edges. Node type/layer compatibility is fixed as `observation->context`, `judgment/decision->judgment`, `resource->resource`, `execution/outcome->execution`, and `evaluation->evaluation`. `node.depends_on` is the executable topology SSOT; every dependency pair must have exactly one matching `relation=depends_on` edge, and every such edge must have exactly one matching node dependency. Validation is a pure, fail-closed preflight operation and returns a deterministic topological order with node-ID ascending tie-breaks. Both endpoints of each dependency must have identical `scope.type` and `scope.id`.

The `depends_on` edge is a required exact mirror, not a duplicate declaration. Structural validity does not grant execution authority. Cross-scope promotion and authority evidence are later scope and governance work, not this contract slice.

## Acceptance/test references

| ID | Requirement | Test/source reference |
|---|---|---|
| AC-001 | Typed contract, compatibility map, and strict schema | `src/judgment-dag-core.ts`, `src/judgment-dag.ts`, `contracts/judgment-dag/schema.json` |
| AC-002 | Deterministic valid five-layer happy path | `tests/judgment-dag-core.test.ts`, `contracts/judgment-dag/fixture.json` |
| AC-003 | Dependency integrity, exact mirror, and type/layer rejection | `src/judgment-dag-core.ts`, `tests/judgment-dag-core.test.ts` |
| AC-004 | Exact-scope fail-closed boundary and non-authority boundary | `src/judgment-dag-core.ts`, `docs/architecture/judgment-dag-core.md`, `tests/judgment-dag-core.test.ts` |
| AC-005 | Recursive metadata validation | `src/judgment-dag-core.ts`, `tests/judgment-dag-core.test.ts` |
| AC-006 | Pure validation, immutable fixtures, and stable order | `tests/judgment-dag-core.test.ts` |
| AC-007 | Machine artifacts, schema/runtime parity, and consumer contract | `contracts/judgment-dag/*`, `tests/judgment-dag-public-contract.test.ts`, `tests/npm-consumer-smoke.integration.test.ts` |

The package root remains the MCP startup entrypoint. Only the `./judgment-dag` subpath is side-effect free.

## Explicit non-goals

This slice does not implement or verify runner execution, artifact storage, execution logs, replay, evaluation mutation, or Execution/Evaluation mutation protection. Those are J0-2 follow-up scope and must not be inferred from this contract or its tests.
