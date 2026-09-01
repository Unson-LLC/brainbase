# Brainbase Core Philosophy

<!-- brainbase:public-message:start -->
## Central promise

> **一般論ではなく、あなたの判断基準から始まるAI。**

Brainbaseは、仕事の前提、優先順位、過去の判断とその理由をローカルの正本に置き、CodexやClaude Codeが新しいセッションでも同じ文脈から考え始められるようにするOSSです。

## Human and AI responsibility

- **Human:** 人間は、仕事の目的、判断基準、任せてよい範囲を決める。Human authority defines who the judgment is for, what it prioritizes, what it protects, and what may be delegated.
- **AI:** AIは、それらを参照して選択肢を比較し、見落としを指摘し、許可された範囲を進める。AI must search broadly, surface the strongest counterargument, preserve evidence, and stay inside approved execution boundaries.

A judgment is not correct in the abstract. It is correct or incorrect only relative to an explicit subject, objective, priority, protected constraint, and authority boundary.
<!-- brainbase:public-message:end -->

## Company as a judgment system

Brainbase starts from a simple hypothesis:

> A company is not merely a collection of information. It is a system that accumulates judgments, turns them into commitments and actions, and updates those judgments from outcomes.

Documents, messages, meeting notes, databases, and source code are evidence and traces. They matter, but they do not by themselves explain why an organization behaves as it does.

The durable structure around judgment includes:

- goals and protected constraints
- observations and evidence
- assumptions and hypotheses
- judgments and decisions
- actors, authority, and approval
- commitments and actions
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

Brainbase makes that loop explicit, inspectable, reusable, replayable, and transferable between humans and agents.

## Knowledge is evidence, not the final unit of value

A knowledge base can answer "what information exists?" Brainbase must also answer:

- Why did we decide this?
- Which evidence and assumptions supported it?
- Who had authority to decide?
- What did the decision prioritize and protect?
- Is it still valid?
- What would invalidate or supersede it?
- What happened after execution?
- What should the next human or agent learn?

Documents and conversations are sources. The durable units are the entities and relationships that explain the current judgment state.

## Judgment is temporal

A person or company is not the sum of every judgment it has ever made.

Judgments become active, constrained, revised, superseded, or invalidated as assumptions and context change. Brainbase preserves that temporal structure instead of flattening contradictory historical records into one search corpus.

A judgment should remain interpretable through fields such as:

```text
Judgment
- subject / beneficiary
- objective
- priority
- protected_constraint
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

The exact ontology may evolve, but the principle is stable: distinguish what was once believed from what is currently authoritative, and explain why.

## Judgment has layers

Not every judgment has the same organizational weight.

1. **Case judgment** — a decision for a specific situation.
2. **Policy judgment** — a reusable rule for a class of situations.
3. **Structural judgment** — a decision embedded into organization, software, contracts, roles, budgets, or process.
4. **Meta-judgment** — a rule about who may decide, which evidence is required, and how conflicting criteria are resolved.

Repeated case judgments can become policy. Repeated policy enforcement can become structure or culture. Brainbase makes that evolution observable and approval-gated.

## The product goal

Brainbase is not only a memory system or retrieval layer for AI.

Its deeper purpose is to externalize judgment capability so that a person or organization can:

- preserve the reasoning behind important choices;
- avoid reopening resolved questions without new evidence;
- detect when old assumptions no longer hold;
- transfer decision context to another human or agent;
- delegate work without silently delegating authority;
- learn from the outcomes of prior actions;
- progressively turn individual judgment into reusable organizational capability.

The practical test is not whether Brainbase stores more information. The test is whether a future human or agent can make a better, contextually faithful decision because the relevant judgment structure survived.
