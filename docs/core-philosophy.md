# Brainbase Core Philosophy

## Company as a judgment system

Brainbase starts from a simple hypothesis:

> A company is not merely a collection of information. It is a system that accumulates judgments, turns them into structures and actions, and updates those judgments from outcomes.

Documents, messages, meeting notes, databases, and source code are important, but they are evidence and traces. They do not by themselves explain why an organization behaves as it does.

What makes an organization distinct is how it interprets the information available to it, what it chooses, who is allowed to choose, and how those choices are revised when reality changes.

A useful company memory therefore needs to preserve more than facts. It needs to preserve the structure around judgment:

- goals and constraints
- observations and evidence
- assumptions and hypotheses
- judgments and decisions
- actors and authority
- actions and commitments
- outcomes and lessons
- validity, supersession, and review conditions

The intended loop is:

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

Brainbase should help make that loop explicit, inspectable, reusable, and transferable between humans and agents.

## Knowledge is evidence, not the final unit of value

A knowledge base can answer "what information exists?" Brainbase aims to help answer additional questions:

- Why did we decide this?
- Which evidence and assumptions supported the decision?
- Who had authority to make it?
- Is the decision still valid?
- What would invalidate or supersede it?
- What happened after we acted on it?
- What should the next person or agent learn from that outcome?

For this reason, Brainbase should not treat documents as the primary representation of organizational intelligence. Documents and conversations are sources. The more durable units are the entities and relationships that explain the organization's current judgment state.

## Judgment is temporal

A company is not the sum of every judgment it has ever made.

Judgments become active, constrained, revised, superseded, or invalidated as their assumptions and context change. Brainbase should preserve this temporal structure rather than flattening contradictory historical records into an undifferentiated search corpus.

A judgment should be interpretable through fields such as:

```text
Judgment
- context
- evidence
- assumptions
- rationale
- actor / authority
- decided_at
- validity
- review_conditions
- supersedes / superseded_by
- resulting_action
- observed_outcome
```

The exact ontology may evolve, but the design principle is stable: the system should make it possible to distinguish what was once believed from what is currently authoritative and why.

## Judgment has layers

Not every judgment has the same organizational weight. Brainbase should be able to represent at least these layers conceptually:

1. **Case judgment** — a decision for a specific situation.
2. **Policy judgment** — a reusable rule for classes of situations.
3. **Structural judgment** — a decision embedded into organization, software, contracts, roles, budgets, or process.
4. **Meta-judgment** — a rule about who may decide, what evidence is required, and how conflicting criteria are resolved.

Repeated case judgments can become policy. Repeated policy enforcement can become organizational structure or culture. Brainbase should make that evolution observable rather than leaving it implicit.

## The product goal

Brainbase is therefore not only a memory system or retrieval layer for AI.

Its deeper purpose is to externalize judgment capability so that a person or organization can:

- preserve the reasoning behind important choices;
- avoid re-litigating resolved questions without new evidence;
- detect when old assumptions no longer hold;
- transfer decision context to another human or agent;
- learn from the outcomes of prior actions;
- progressively turn individual judgment into reusable organizational capability.

The practical test is not whether Brainbase stores more information. The test is whether a future human or agent can make a better, more contextually faithful decision because the relevant judgment structure survived.
