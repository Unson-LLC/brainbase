# Unson Brainbase: Company as a Judgment System

## Core hypothesis

Unson operates Brainbase from the following hypothesis:

> A company is not merely a collection of information. It is a system that accumulates judgments, turns those judgments into structures and actions, and updates them from outcomes.

The important asset is not only what the company knows, but how it interprets evidence, what it chooses, who is allowed to choose, how those choices become action, and how later results revise the next judgment.

This means company knowledge should be modeled as more than documents or searchable text. Documents, meetings, messages, and source code are evidence and traces. The durable organizational memory is the judgment structure connecting them.

## Operating loop

```text
Observation
  -> Interpretation
  -> Judgment
  -> Commitment
  -> Action
  -> Outcome
  -> Learning
  -> Judgment update
```

For important judgments, Brainbase should preserve enough structure to answer:

- What goal or constraint was relevant?
- What observations and evidence were considered?
- Which assumptions were active?
- What alternatives were rejected?
- Who made or authorized the judgment?
- What action followed?
- What outcome occurred?
- Is the judgment still valid?
- What would cause it to be reviewed or superseded?

## Why this matters for Unson

Unson has a high concentration of judgment in a small number of people. If those judgments remain in individual heads, chat histories, or one-off project conversations, adding people increases coordination cost instead of organizational capability.

The purpose of the Unson Brainbase is therefore not simply to retain more information. It is to convert individual judgment into reusable company capability.

A successful system lets a future human or agent say:

> In a similar context, Unson previously observed X, considered Y, rejected Z, and made judgment A for these reasons. The current case differs in B, so the prior judgment should be reused, adapted, or escalated.

That is more valuable than retrieving the original meeting note alone.

## Brainbase Deployment as dogfooding

`Brainbase Deployment` should be operated as a first-class project inside the Unson organization Brainbase.

Its purpose is to externalize the capability required to deploy Brainbase into another company. It should accumulate not just procedures and deliverables, but the judgments that produce them.

Each deployment should capture patterns such as:

```text
Context
  -> Observation
  -> Hypothesis
  -> Question
  -> Evidence
  -> Judgment
  -> Implementation
  -> Outcome
  -> Lesson
```

Examples include:

- why a particular discovery question was asked;
- why one ontology boundary was selected over another;
- why information was classified as customer-specific or reusable;
- why a design was rejected;
- which deployment pattern generalized across customers;
- which assumption failed in production;
- which issue required escalation to Keigo and why.

Customer-specific facts and decisions should remain in that customer's project. Only patterns judged reusable across deployments should be promoted into `Brainbase Deployment` as shared company knowledge or judgment.

## Deployment success metric

The primary metric is not how many documents or lessons are stored.

The more meaningful metric is:

> How many decisions in the next deployment still require Keigo's direct judgment?

That number should decline over successive deployments.

The intended progression is:

1. Keigo performs the judgment and Brainbase records the structure.
2. Brainbase or an agent proposes the judgment from prior patterns; Keigo reviews it.
3. A Deployment Lead executes the known pattern and escalates only unknown cases.
4. New outcomes update the shared deployment judgment system.

The goal is not to reproduce Keigo as a person. The goal is to reduce the set of decisions that require him personally.

## Design implications

The Unson Brainbase should treat the following as first-class concepts where practical:

- Goal
- Observation
- Evidence
- Assumption
- Hypothesis
- Judgment
- Decision
- Policy
- Authority
- Actor
- Action
- Outcome
- Lesson
- Validity / review condition
- Supersession

The exact schema can evolve. The invariant is that company intelligence must not collapse into a flat document archive or RAG corpus.

The system should preserve enough temporal and causal structure to distinguish:

- what was known;
- what was believed;
- what was decided;
- why it was decided;
- whether it is still authoritative;
- what happened because of it;
- what the company should learn next.

## Product and organizational implication

If Brainbase claims to help companies externalize judgment while Brainbase deployments themselves remain dependent on one person's tacit judgment, the product has not yet solved its own problem.

For Unson, deployment is therefore both customer delivery and product development. Growin and subsequent design partners should be used to identify the reusable core, while `Brainbase Deployment` becomes the organizational memory that makes the next implementation less dependent on Keigo.

The long-term asset is not a collection of completed Brainbase projects. It is Unson's increasingly explicit and transferable ability to understand a company, model its judgment system, deploy Brainbase, and learn from the result.
