---
title: Brainbase Domain Judgment DAG Platform Vision
status: proposed
date: 2026-08-30
scope: Unson internal future product direction
related:
  - docs/company-as-judgment-system.md
---

# Brainbase Domain Judgment DAG Platform Vision

## Vision

> **Brainbase is not one Judgment DAG. It is the shared organizational intelligence platform that selects, runs, connects, governs, and improves the Judgment DAGs used across a company.**

Brainbase should enable a company to externalize not only what it knows, but how each business domain turns context into judgment, bounded action, outcome evaluation, and learning.

Development, tax, sales, marketing, back office, legal, security, and management have different domain semantics. They should not be flattened into one monolithic company DAG. Each domain should provide its own typed Judgment DAGs and evidence contracts while reusing Brainbase's common context, scope, policy, authority, runtime, receipt, and learning primitives.

```text
                              Brainbase
             Organizational Context / Judgment / Learning Plane
                                  │
          ┌───────────────┬───────┴────────┬───────────────┐
          │               │                │               │
       VibePro          Zeims          Sales domain    Other domains
       Development      Tax/accounting  Sales DAGs      Marketing
       Judgment DAGs    Judgment DAGs                  Back office
          │               │                │               │
   Coding agents      Tax agents       CRM / agents    Domain systems
   GitHub / CI        Ledger / filing  Contracts       Systems of record
```

The intended outcome is not that every operation moves into Brainbase. The intended outcome is that every important operation can obtain the correct context, apply the appropriate domain judgment structure, stay inside an explicit authority boundary, and return reusable learning.

## Product position

Brainbase is the company's **Organizational Intelligence Plane**.

It has three connected responsibilities.

### 1. Context Plane

The Context Plane determines what information is relevant, current, canonical, and accessible for the present request.

It should answer questions such as:

- Which project, organization, owner, and customer does this request concern?
- Which source is the canonical source of truth for this kind of information?
- Which version is currently valid?
- Which past incidents, decisions, policies, and outcomes are relevant?
- Where is a required credential managed, and which approved capability may retrieve it?
- Which sources were intentionally excluded or not searched?

The Context Plane does not replace source systems. It routes agents to them and preserves provenance, scope, temporal validity, and access boundaries.

### 2. Judgment Plane

The Judgment Plane selects and resolves the applicable domain DAGs, policies, authority, risk, and autonomy boundary.

It should answer:

- Which domain DAG or combination of DAGs applies?
- Which evidence and assumptions are required?
- Which policies constrain the result?
- Who has authority to decide or execute?
- May the agent continue, or must it escalate?
- What changed since the previous resolution?
- Which receipt binds the judgment to the subsequent action?

Brainbase owns the shared judgment runtime and governance contract. Domain products own the domain-specific meaning of the judgment.

### 3. Learning Plane

The Learning Plane turns outcomes into reusable organizational capability without treating raw AI output as truth.

```text
Raw Event
  -> Learning Candidate
  -> Validated Learning
  -> Project Practice
  -> Organization Practice
  -> Policy or DAG version
```

Examples include:

- a deployment failure and its verified root cause;
- an inefficient test or review procedure and a measured improvement;
- a rejected design and the evidence that invalidated it;
- a tax treatment that was accepted or corrected by an authorized expert;
- a sales promise that caused implementation or contract risk;
- a repeated judgment that no longer requires the original expert.

Promotion between these stages must require evidence, provenance, scope, and authority. Raw chain-of-thought, transient debugging logs, unverified hypotheses, and every PR comment must not become canonical organizational knowledge.

## Domain Judgment Packs

A domain product should contribute a **Domain Judgment Pack**, not a second independent organizational brain.

A Domain Judgment Pack may contain:

- domain-specific DAG definitions and versions;
- typed input and output contracts;
- required evidence rules;
- domain policies and evaluation criteria;
- domain-specific receipts and artifacts;
- adapters to the relevant execution agents and systems of record;
- learning candidate extractors;
- escalation reasons that are meaningful in that domain.

### Development: VibePro

VibePro is the development domain.

It should provide development-specific Judgment DAGs and change contracts for concerns such as:

- Product Intent consistency;
- architecture and data-boundary impact;
- Story and Spec necessity;
- Acceptance Criteria;
- implementation and verification strategy;
- release and rollback evidence;
- technical completion;
- recurring development problems and reusable engineering practices.

VibePro should not duplicate Brainbase's global identity, scope, policy, authority, provenance, or learning-promotion runtime. GitHub and CI remain the source of truth for code, tests, PRs, releases, and technical evidence.

### Tax and accounting: Zeims

Zeims is the tax and accounting domain.

It should provide tax-specific Judgment DAGs and evidence contracts for concerns such as:

- transaction classification;
- taxable, exempt, or non-taxable treatment;
- evidence sufficiency;
- filing and payment deadlines;
- ledger and return consistency;
- materiality and risk;
- cases requiring an accountant, tax professional, or executive decision;
- later corrections and their reusable lessons.

Zeims should not replace the accounting ledger, filing system, or authorized professional. Those systems and people remain sources of fact and authority.

### Future domains

The same structure should be applicable to:

| Domain | Example judgments | External source of truth |
| --- | --- | --- |
| Sales | ICP fit, pricing, discount, promise, proposal, escalation | CRM, contract, customer record |
| Marketing | audience, message, claim evidence, budget, experiment | campaign platform, analytics |
| Back office | purchase, payment, hiring, approval, evidence | ERP, HRIS, banking, contract |
| Legal | clause risk, approval, obligation, renewal | signed contract, legal system |
| Security | access, incident severity, containment, disclosure | IAM, SIEM, incident record |
| Management | priority, resource allocation, cross-program trade-off | approved strategy, budget, outcomes |

The existence of a possible domain does not justify implementing it. A new Domain Judgment Pack should be created only after a repeated real judgment can be identified, bounded, evaluated, and improved.

## Shared runtime and domain ownership

The boundary must remain explicit.

### Brainbase owns

- identity and entity resolution;
- global, organization, project, and owner scopes;
- canonical-source routing and provenance;
- policy selection and temporal validity;
- authority and approval boundaries;
- DAG registry, selection, validation, versioning, and replay primitives;
- cross-domain dependency and conflict resolution;
- continue / escalate resolution;
- immutable judgment and execution receipts;
- evaluation links and learning-promotion governance.

### Domain products own

- domain vocabulary and meaning;
- domain-specific DAG nodes and contracts;
- domain evidence requirements;
- domain acceptance and evaluation criteria;
- integration with domain execution tools;
- domain-specific learning candidates.

### Agent hosts own

- obtaining a Brainbase resolution before the model acts when required;
- presenting only the necessary context to the model;
- invoking the selected domain tools and skills;
- enforcing real execution permissions;
- binding actions and results to receipts;
- returning outcomes and anomalies.

### Systems of record own

- authoritative operational facts;
- final external state;
- credentials and secrets;
- code and executable tests;
- signed contracts;
- ledgers and filings;
- CRM activity and customer commitments.

Brainbase should reference and interpret these systems. It should not copy their entire contents or silently become their replacement.

## Brainbase, Skills, and agent instructions

These layers solve different problems.

```text
AGENTS.md / CLAUDE.md
= bootstrap instructions and repository-local invariants

Brainbase
= what context, source, policy, decision, and authority are valid now

Skills
= how an approved operation is performed

Domain Judgment Pack
= how a domain-specific situation is classified, judged, evidenced, and evaluated

Agent host
= orchestration and enforcement
```

A Skill can explain how to deploy a service. Brainbase should determine which environment is authoritative, which runbook and credential route apply, whether deployment is permitted, which past incidents matter, and whether the present case requires escalation.

Static agent instructions must not grow into a duplicate organization database. Brainbase must not absorb every procedural step that belongs in a versioned Skill or repository runbook.

## Secret boundary

Brainbase may hold secret metadata and routing information, for example:

```text
secret_name
canonical_vault
item_reference
allowed_scope
retrieval_capability
rotation_policy
owner
```

Brainbase must not become the default secret vault and must not store raw secret values as ordinary graph knowledge. The authorized secret manager remains the source of truth, and retrieval occurs through an approved capability with its own access control and audit trail.

## Cross-domain judgment

The highest-value cases often cross domain boundaries.

For example, a customer requests a custom settlement feature in exchange for signing this month.

```text
Customer request
  -> Sales DAG: deal value, price, promise, customer fit
  -> VibePro DAG: Product Intent, architecture, data, delivery risk
  -> Zeims DAG: settlement, revenue recognition, evidence implications
  -> Management DAG: priority, opportunity cost, resource commitment
  -> Brainbase: combine dependencies, detect conflicts, resolve authority
  -> continue, conditional continuation, or escalation
```

No domain may silently override another domain's protected constraint. Brainbase should preserve each domain's result, identify the conflict, apply explicit cross-domain policy and authority, and produce a case-bound resolution receipt.

This must not become one monolithic company DAG. Composition should occur through typed inputs, outputs, dependencies, and declared conflict rules.

## Scope and promotion

The shared scope model enables judgment to mature without creating separate schemas.

```text
Owner judgment
  -> repeated evidence and review
Project practice
  -> cross-project evidence and authority
Organization policy
  -> explicit governance and versioning
Global constraint
```

An owner's preference must not become organization policy merely because the owner made the decision. Promotion should require:

- repeated or otherwise strong evidence;
- defined applicability and counterexamples;
- an explicit owner or approving authority;
- success and failure conditions;
- a review or expiry condition;
- a new version rather than silent mutation.

## Learning across domains

Brainbase should allow a verified lesson in one domain to improve another domain when the relationship is explicit.

Example:

```text
Development incident:
A verbal customer request was implemented without bounded acceptance.

Potential reusable learning:
- Sales: customer promises require a structured commitment record.
- Development: implementation requires explicit acceptance and authority.
- Legal: custom work must be separated from standard product obligations.
- Management: Product Intent exceptions require an explicit trade-off decision.
```

Cross-domain reuse must be proposed and evaluated; it must not be inferred into policy automatically.

## Brainbase and Mana

Brainbase owns executable organizational cognition:

- what context is valid;
- which DAG applies;
- what authority exists;
- what the judgment produced;
- how the outcome should be evaluated;
- what learning may be promoted.

Mana owns continuous organizational operation:

- when to run the relevant DAGs;
- how to prioritize competing goals over time;
- how to initiate and follow through on work;
- how to monitor incomplete commitments;
- when to re-run, intervene, or escalate.

```text
Brainbase = organizational cognition and learning substrate
Mana      = continuous autonomous operation over that substrate
```

## Non-goals

- Do not build one universal monolithic company DAG.
- Do not copy every domain database or document into Brainbase.
- Do not make VibePro, Zeims, or another domain product reimplement the common Brainbase runtime.
- Do not infer execution authority from a valid DAG alone.
- Do not store raw secrets as normal Brainbase knowledge.
- Do not auto-promote AI-generated text, chain-of-thought, or unverified observations.
- Do not make all work require a formal DAG or human approval.
- Do not confuse future vision with currently released capability.
- Do not make Brainbase an always-on operator; that remains Mana's boundary.

## Current and planned boundary

This document defines direction, not a claim that the complete platform already exists.

| Capability | Direction as of 2026-08-30 |
| --- | --- |
| Shared Judgment DAG semantic model and local runtime | Implemented foundation / evolving |
| Personal, project, and organization scope primitives | Implemented foundation / governance evolving |
| Canonical context and source routing | Partially implemented / evolving |
| Host pre-model judgment resolution and receipts | Implemented for current supported host path / evolving |
| Domain Judgment Pack contract and registry | Planned |
| VibePro domain adapter and receipt binding | Planned / existing pieces must be reconciled |
| Zeims domain adapter | Planned |
| Cross-domain DAG composition and conflict policy | Planned |
| Validated learning promotion from event to practice and policy | Partially implemented / planned |
| Organization-grade RBAC, managed connectors, audit retention, and HA | Organization/Enterprise direction |

Released, develop, and planned states must remain visible in implementation documentation and public product claims.

## Proving sequence

The recommended proving order is:

1. **Development with VibePro** — prove that development context, judgment, execution evidence, and learning reduce repeated expert intervention.
2. **Tax with Zeims** — prove that the shared runtime can support a materially different domain with stricter evidence and authority requirements.
3. **Cross-domain case** — prove composition across sales, development, tax, and management without creating a monolithic DAG.
4. **Additional domains** — add sales, marketing, back office, legal, or security only from repeated real cases.

The platform is not proven by the number of DAGs or documents stored. It is proven when different domains can share organizational context and governance while retaining their own semantics.

## Success measures

The primary outcome is a reduction in decisions that unnecessarily return to the original expert without reducing safety or intent fidelity.

Useful measures include:

- number of repeated questions requiring the original expert;
- time required to find the canonical source or operational route;
- rate of correct continue / escalate decisions;
- recurrence rate of previously understood failures;
- percentage of validated learning reused in later work;
- decision reversals caused by stale or wrong context;
- manual effort required to maintain DAGs and knowledge;
- cross-domain conflicts detected before external commitment;
- outcome quality compared with the stated objective and protected constraints.

## Stable product invariant

The implementation may change, but the invariant is:

> **Each domain defines how it judges. Brainbase makes those judgments available to the organization, connects them to shared context and authority, and improves them from outcomes.**

VibePro should make the next development change better. Zeims should make the next tax judgment better. Brainbase should make the organization better at every future judgment that can reuse what those domains learned.
