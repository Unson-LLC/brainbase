---
story_id: story-j0-judgment-dag-core-contract
title: J0 Judgment DAG core contract
status: accepted
architecture: docs/architecture/judgment-dag-core.md
spec: docs/specs/j0-judgment-dag-core-contract.md
canonical_task: docs/management/tasks/j0-judgment-dag-core-contract.json
source_lock: contracts/judgment-dag/source-lock.json
---

# Story: J0 Judgment DAG core contract

As a Brainbase core consumer, I need an immutable, typed Judgment DAG contract so malformed dependencies are rejected before any runner can execute them.

The accepted five-layer ontology is `context -> judgment -> resource -> execution -> evaluation`. `observation` maps to `context`; `judgment` and `decision` map to `judgment`; `resource` maps to `resource`; `execution` and `outcome` map to `execution`; and `evaluation` maps to `evaluation`. An outcome is produced and recorded by the Execution DAG, not a sixth layer.

## Acceptance criteria

- AC-001: Typed node/edge/scope contract and the node-type/layer compatibility map are exported from `src/judgment-dag.ts` and defined in `src/judgment-dag-core.ts`.
- AC-002: Preflight rejects missing dependencies, reverse-layer dependencies, cycles, duplicate declarations, and node-type/layer impersonation with machine-readable validation codes (`tests/judgment-dag-core.test.ts`).
- AC-003: Authority, provenance, and evaluation metadata are recursively JSON-compatible and invalid nested values are rejected before execution (`tests/judgment-dag-core.test.ts`).
- AC-004: Validation is side-effect free and topological ties are normalized by ascending node ID; immutable fixtures and reordered equivalent DAGs produce the same result (`tests/judgment-dag-core.test.ts`).
- AC-005: The versioned package contract includes schema, fixture, source-lock/digest, and a side-effect-free `./judgment-dag` consumer import (`tests/judgment-dag-public-contract.test.ts`, `tests/npm-consumer-smoke.integration.test.ts`).

This is a contract slice only. Runner, artifact, execution-log, replay/evaluation, and Execution/Evaluation mutation protection are J0-2 non-goals and remain unverified.
