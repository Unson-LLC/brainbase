---
title: Organization Judgment DAG Architecture
status: accepted
date: 2026-08-20
scope: brainbase-unson / enterprise organization deployment
---

# Organization Judgment DAG Architecture

## Decision

`brainbase-unson` does not define a separate organization-only DAG schema. It consumes the same Judgment DAG semantic model and runtime core as OSS `brainbase`, then adds enterprise governance, authority, security, and operational controls.

The organization product is therefore an extension of the same brain model, not a fork.

```text
brainbase OSS
  ├─ shared ontology primitives
  ├─ Judgment DAG model
  ├─ DAG runtime
  ├─ artifact / execution log
  ├─ replay / evaluation
  └─ personal / project / organization scope
          ↓
brainbase-unson / enterprise
  ├─ organization identity
  ├─ Authority Graph
  ├─ approvals / escalation
  ├─ RBAC / information boundaries
  ├─ managed connectors
  ├─ audit / compliance
  ├─ hosted / multi-user runtime
  └─ organization operations
```

## Organization model

An organization is modeled as a stateful judgment system:

```text
State(t)
  ↓
Context DAG
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
State(t+1) + Judgment DAG update
```

The company is not represented as a pile of documents. Documents, meetings, Slack, CRM, metrics, contracts, and code are evidence sources that feed Context. The durable organizational asset is the explicit structure connecting evidence to reusable judgment and execution.

## Enterprise five-layer mapping

### Layer 1: Context DAG
Enterprise sources become typed context artifacts.

Examples:
- financial state
- sales pipeline
- project status
- customer feedback
- personnel state
- meeting observations
- contract facts

Context may carry confidence, provenance, freshness, and access class, but it must not silently make business choices.

### Layer 2: Judgment DAG
Encodes reusable organizational cognition.

Examples:
- customer fit judgment
- pricing judgment
- priority judgment
- architecture judgment
- hiring judgment
- go/no-go judgment
- policy selection

A reusable Judgment is distinct from a one-off Decision. A Decision commits the organization in a specific context; a Judgment is the reusable model that can produce decisions across contexts.

### Layer 3: Resource / Risk DAG
Converts approved judgment into bounded commitment.

Examples:
- money
- people
- executive time
- engineering capacity
- risk limit
- approval threshold
- scope

### Layer 4: Execution DAG
Turns commitments into real-world actions.

Examples:
- proposal
- contract routing
- hiring action
- implementation task
- deployment
- customer communication
- payment / purchase

Execution must not silently overwrite upstream policy or judgment.

### Layer 5: Evaluation DAG
Compares actual outcome with explicit organizational goals.

Examples:
- revenue / gross profit
- decision latency
- delivery quality
- customer result
- expert escalation count
- reusable capability extraction rate
- resource efficiency

Evaluation proposes updates to the DAG; governance determines whether those updates become canonical.

## Authority Graph

Organization usage differs from personal usage primarily because authority becomes explicit and contextual.

Every material judgment/decision node can reference:

```text
proposed_by
runner
accountable_owner
approver
veto_authority
escalation_target
authority_scope
authority_valid_from / valid_to
```

Examples:

```text
pricing_decision
  runner = sales-agent
  accountable_owner = sales-director
  escalate_if = discount > 20%
  approver = CEO when ARR > threshold

capital_allocation
  runner = finance-agent
  accountable_owner = CEO
  approver = board when amount > threshold
```

Brainbase must never infer material authority solely from message frequency, senior-sounding language, or LLM confidence.

## Customer-specific vs reusable judgment

Enterprise deployments must keep two scopes separate.

```text
Customer Project Scope
  └─ customer-specific facts / decisions / artifacts

Brainbase Deployment Scope
  └─ reusable patterns / judgment nodes / playbooks
```

A customer-specific judgment is promoted only when evidence supports reuse and the correct Unson authority approves it.

This is the mechanism by which Growin, Kartz, and future deployments improve the shared deployment capability without turning the product into a customer-specific fork.

## Brainbase Deployment dogfood

`Brainbase Deployment` is the first reference Organization Judgment DAG.

Initial shape:

```text
Customer Context
   ↓
Customer Maturity Judgment
   ↓
Problem Structure Judgment
   ↓
Deployment Pattern Selection
   ↓
Scope / Resource Decision
   ↓
Proposal
   ↓
Implementation
   ↓
Outcome Evaluation
```

At first, Keigo can be a `human` runner on difficult judgment nodes. Every direct escalation must become an explicit DAG event with context and reason.

The target is not to clone Keigo into another human. The target is to shrink the set of nodes that require him.

## Delegation maturity

Track each node through maturity states:

```text
H0: expert-only, implicit
H1: expert-only, explicit inputs/outputs
H2: agent drafts, expert approves
H3: agent executes, expert audits
H4: delegated, exception-only escalation
```

A deployment is becoming organizational capability only when material nodes move from H0/H1 toward H3/H4.

## Enterprise runtime requirements

Organization deployment adds:
- scoped RBAC
- data classification and clearance
- approval workflow
- human-step queues
- immutable audit events
- concurrent users/runs
- organization directory integration
- managed connector lifecycle
- secret management
- retention policy
- failure/retry semantics
- hosted runtime observability

These extend runtime safety and governance but do not alter the underlying node/edge semantics.

## Relationship with Mana

Brainbase can execute judgment DAGs and preserve their artifacts. Mana remains the autonomous operating layer that decides when to run them continuously, prioritizes across goals, initiates work, monitors completion, and intervenes over time.

```text
Brainbase = organizational cognition substrate
Mana      = autonomous operating supervisor
```

## Design constraints

1. Do not fork the OSS DAG schema for enterprise.
2. Do not create one giant company DAG; compose domain/project DAGs through explicit dependencies.
3. Do not hide human judgment in chat; represent it as a runner and artifact.
4. Do not mix customer-specific context into reusable deployment policy without promotion.
5. Do not allow Execution to reimplement Judgment.
6. Do not evaluate success without explicit Goal and metric contracts.
7. Do not treat more stored documents as progress toward delegation.

## Primary success metric

For Brainbase Deployment, the primary metric is:

**expert escalations requiring Keigo per deployment**

Secondary metrics:
- Keigo hours per deployment
- percentage of judgment nodes at H3/H4
- reusable node/pattern rate
- deployment cycle time
- gross profit per Keigo hour
- outcome calibration by DAG version
