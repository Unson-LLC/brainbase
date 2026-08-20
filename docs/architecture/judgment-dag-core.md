---
title: Brainbase Judgment DAG Core
status: accepted
date: 2026-08-20
scope: OSS Brainbase / shared core
supersedes_in_part: docs/architecture/brainbase-memory-loop-product-boundary.md
---

# Brainbase Judgment DAG Core

## Decision

Brainbase OSS and organization deployments share the same Judgment DAG semantic model and runtime core.

Brainbase is not only a memory/knowledge store. Its core responsibility is to externalize, preserve, replay, evaluate, and improve the structure by which a person or organization turns context into judgment and action.

The prior product boundary that limited OSS Brainbase to `Remember / Organize / Retrieve / Learn` is revised. Brainbase owns the **judgment substrate**; Mana may own autonomous operating loops, continuous follow-through, and outcome ownership on top of that substrate.

```text
Brainbase = Remember / Organize / Retrieve / Judge / Replay / Learn
Mana      = Operate / Prioritize continuously / Act autonomously / Follow-through
```

Brainbase may represent and execute judgment nodes. It does not become an always-on autonomous operator merely because it can execute a DAG.

## Core hypothesis

A person or organization can be modeled as a stateful system that repeatedly executes a directed judgment graph:

```text
State(t)
   ↓
Context / Observation DAG
   ↓
Judgment DAG
   ↓
Resource / Risk DAG
   ↓
Execution DAG
   ↓
Outcome
   ↓
Evaluation DAG
   ↓
State(t+1) + DAG update
```

The durable asset is not the document corpus itself. It is the reusable structure connecting evidence, assumptions, judgments, decisions, commitments, actions, outcomes, and updates.

## Shared five-layer model

### Layer 1: Context DAG
Produces normalized observations and state required by downstream judgment.

Allowed:
- facts and observations
- metrics and snapshots
- entity resolution
- source provenance
- temporal validity

Forbidden:
- strategic choice
- resource allocation
- external action

### Layer 2: Judgment DAG
Produces reusable interpretations and decisions from Context outputs.

Examples:
- priority judgment
- pricing judgment
- product fit judgment
- go/no-go judgment
- policy selection

Forbidden:
- direct mutation of execution state
- hidden reads from raw sources that bypass Context contracts
- direct resource commitment

### Layer 3: Resource / Risk DAG
Converts judgments into bounded commitments.

Examples:
- budget
- time allocation
- staffing
- risk limit
- approval threshold
- scope

Forbidden:
- reimplementing upstream business judgment
- performing the external action itself

### Layer 4: Execution DAG
Turns approved commitments into actions and records execution artifacts.

Examples:
- create task
- send proposal
- deploy software
- sign/route contract
- schedule meeting

Forbidden:
- silently changing upstream judgment or policy
- acquiring authority that was not granted by the DAG

### Layer 5: Evaluation DAG
Compares outcomes against explicit goals and evaluation criteria.

Examples:
- forecast error
- KPI pass/fail
- decision quality
- resource efficiency
- user value confirmation

Evaluation can propose an update to a judgment/policy/DAG version; it does not silently rewrite canonical judgment without the required authority.

## Node contract

A shared Judgment DAG node SHOULD converge on the following semantic contract:

```text
id
node_type
layer
scope
version
description

depends_on[]
input_contract
output_contract

runner_type
  deterministic
  agent
  human
  committee
  external

authority
confidence
valid_from
valid_to
provenance

evaluation
```

Initial node types should stay intentionally small:

```text
observation
judgment
decision
resource
execution
outcome
evaluation
```

Ontology growth must be driven by failed real use cases, not by speculative completeness.

## Edge contract

Knowledge/identity relations and judgment dependencies are different concepts and must not be collapsed.

Judgment DAG edges include:

```text
depends_on
supports
contradicts
gates
supersedes
produces
evaluated_by
triggers
```

`depends_on` defines executable DAG topology. Relations such as `member_of`, `owned_by`, or `accountable_for` remain graph semantics and can be referenced by DAG nodes.

## Scope model: personal and organization use the same DAG

Do not create separate `PersonalDecision` and `CompanyDecision` schemas.

A node is scoped instead:

```text
scope:
  type: personal | project | organization
  id: <scope-id>
```

This enables promotion:

```text
Personal Judgment
   ↓ evidence / repeated success
Project Judgment
   ↓ promotion / authority
Organization Policy
```

A judgment can therefore move from an individual's learned heuristic into an organizational capability without translation into a separate schema.

## Runtime principles inherited from FX / keiba DAG work

Brainbase adopts the architecture lessons proven in the `sintariran/FX` and `sintariran/keiba` DAG systems:

1. **Layer ownership is explicit.** A downstream layer must not reimplement an upstream decision.
2. **Inputs and outputs cross typed contracts.** No hidden state side channels.
3. **Dependencies are validated before execution.** Missing or reverse-layer dependencies are errors.
4. **Every run produces artifacts and an execution log.** A judgment must be replayable and auditable.
5. **DAG versions are first-class.** A changed judgment structure is a new version, not an invisible mutation.
6. **Evaluation is separate from execution.** Metrics must not be gamed by modifying the system under evaluation.

## OSS / organization boundary

The Judgment DAG core is OSS-level product capability.

OSS includes:
- node/edge semantic model
- dependency validation
- local execution runtime
- human and agent runners
- local artifact/execution log
- versioning
- replay/evaluation primitives
- personal/project/organization scope primitives
- basic authority metadata

Organization/Enterprise adds operational concerns rather than a different brain model:
- organization identity and directory integration
- robust RBAC / authority graph
- approval and escalation workflows
- multi-user concurrency
- managed connectors
- audit/compliance retention
- hosted runtime and HA
- cross-project governance
- enterprise security boundaries

## Mana boundary after this decision

Mana is no longer defined as the only place where judgment can occur.

Brainbase owns **what the judgment graph is, what it depends on, who/what can run it, what it produced, and how it evaluated**.

Mana owns the higher-order operating behavior that repeatedly decides *when* to run graphs, prioritizes across goals, initiates work, monitors progress, follows through, and intervenes over time.

```text
Brainbase: executable organizational cognition
Mana: autonomous organizational operation
```

## Non-goals

- Do not migrate the entire Brainbase ontology to a large Company Ontology in one release.
- Do not make all knowledge executable.
- Do not let an LLM infer authority implicitly.
- Do not create a single monolithic company DAG.
- Do not auto-promote personal judgments into organization policy without explicit evidence and authority.

## First proving ground

`Brainbase Deployment` is the first dogfooding domain.

The initial DAG should capture:

```text
Customer Context
  ↓
Maturity / Problem Structure Judgment
  ↓
Deployment Pattern Selection
  ↓
Scope / Resource Decision
  ↓
Proposal / Implementation
  ↓
Outcome Evaluation
```

Human judgment can initially be a runner. Each repeated decision should then be tested for delegation to an agent. The key success signal is a falling count of decisions that still require the original expert directly.
