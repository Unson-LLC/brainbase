---
title: Organization Judgment DAG Milestones
status: active
date: 2026-08-20
scope: brainbase-unson / enterprise
---

# Organization Judgment DAG Milestones

These milestones align `brainbase-unson` with the shared Judgment DAG core while keeping enterprise concerns as extensions rather than schema forks.

## M0 — Shared-core alignment

Goal: remove architecture ambiguity between OSS and organization versions.

Exit criteria:
- Organization DAG explicitly reuses OSS node/edge semantics.
- Enterprise-only responsibilities are listed as governance/runtime extensions.
- Brainbase/Mana boundary is cognition substrate vs autonomous operation.
- Existing docs that imply organization-only judgment semantics are treated as superseded where they conflict.

## M1 — Brainbase Deployment DAG v0

Goal: represent the real deployment process as an explicit DAG before automating it.

Initial nodes:
- customer context collection
- maturity judgment
- problem structure judgment
- deployment pattern judgment
- scope decision
- resource decision
- proposal execution
- implementation execution
- outcome evaluation

Exit criteria:
- One real deployment can be traversed end-to-end.
- Every Keigo-only decision is represented as an explicit human-run node.
- Node inputs/outputs and dependencies are visible.
- Customer-specific artifacts remain in customer scope.

## M2 — Expert judgment capture

Goal: turn tacit deployment judgment into reusable organizational capability.

Deliverables:
- escalation event capture
- rationale/evidence attachment
- H0-H4 delegation maturity tracking
- reusable-pattern promotion candidate flow

Exit criteria:
- Keigo escalations can be counted per deployment.
- Repeated escalations can be clustered into missing judgment nodes or missing context.
- At least one repeated expert judgment is promoted into a reusable deployment node/policy.

## M3 — Agent-assisted deployment

Goal: move selected nodes from human-only to agent-draft/approval.

Deliverables:
- agent runners using explicit context contracts
- human approval steps
- authority checks
- output comparison against expert decisions

Exit criteria:
- At least two material judgment nodes reach H2 or higher.
- Agent output is auditable against the exact inputs used.
- Low-confidence/authority-sensitive cases escalate instead of auto-committing.

## M4 — Growin design-partner proof

Goal: prove the Company Brain model against a real organization rather than a synthetic ontology.

Exit criteria:
- Growin has at least one live judgment chain from evidence → judgment → decision → resource → action → outcome.
- Brainbase can answer: current policy, why it exists, what evidence supports it, who can change it, and what it affects downstream.
- Invalid/superseded judgments do not appear as current policy.
- Growin-specific requirements are separated from reusable Brainbase core requirements.

## M5 — Second-company portability proof

Goal: distinguish product capability from Growin-specific consulting.

Target: Kartz Media Works or another second design partner.

Exit criteria:
- The second deployment reuses the same DAG semantics without schema fork.
- Reusable Deployment nodes are reused as-is or versioned explicitly.
- Customer-specific adapters remain outside shared core.
- The second deployment requires fewer Keigo escalations than the first on comparable phases.

## M6 — Enterprise Authority Graph

Goal: make organizational decision rights executable and auditable.

Deliverables:
- accountable owner
- approver/veto/escalation
- scoped authority
- validity period
- delegated authority
- threshold-based approval

Exit criteria:
- Brainbase can resolve who is authorized to commit a material decision in context.
- Agent confidence cannot override authority.
- Organization changes can invalidate or supersede authority without rewriting historical decisions.

## M7 — Replay / organizational backtest

Goal: evaluate decision structures using recorded historical context and outcomes.

Deliverables:
- immutable run snapshots
- DAG version comparison
- outcome attachment
- explicit goal/evaluation function
- node-level calibration

Exit criteria:
- A prior organization decision can be replayed from the recorded context.
- A proposed DAG version can be compared to the prior version without altering history.
- Evaluation distinguishes bad outcome from bad judgment when the causal evidence is insufficient.

## M8 — Production enterprise operations

Goal: make the shared Judgment DAG safe for multi-user organizational operation.

Deliverables:
- RBAC / clearance
- SSO/directory integration
- approval queues
- immutable audit retention
- managed connectors
- secret lifecycle
- concurrency and locking
- retries/failure recovery
- observability

Exit criteria:
- Enterprise controls wrap the shared DAG model without creating a second semantic implementation.
- A customer can operate a production Company Brain with explicit authority and audit trails.

## KPI hierarchy

Primary:
- expert escalations requiring Keigo per deployment

Secondary:
- Keigo hours / deployment
- gross profit / Keigo hour
- % material nodes at H3/H4
- reusable judgment node ratio
- deployment cycle time
- judgment replay coverage
- authority resolution coverage
- outcome calibration by DAG version

A milestone is not complete because documents or ontology types exist. It is complete only when real judgment moves through the DAG with observable inputs, authority, output, and evaluation.