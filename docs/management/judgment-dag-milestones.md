---
title: Brainbase Judgment DAG Milestones
status: active
date: 2026-08-20
scope: OSS Brainbase
governed_by_repository: Unson-LLC/brainbase-unson
governed_by_path: docs/management/milestones/brainbase-program-master-roadmap.md
governed_by_machine_path: docs/management/milestones/brainbase-program-master-roadmap.json
governed_by_commit: 18544f58a2a0298d97eab45de2f05544bed48a43
governed_by_markdown_sha256: 167afb6d3fc57198c9f5ffca06fbafea968a5435af04f44b55017199b6d859fe
governed_by_json_sha256: f3e6e023060ef3976f367ed7efa62ac57f7091f517ea1ca1d13824d9e6ca429f
program_packages:
  - R0
  - J0
  - G0
  - R1
  - D0
  - P0
  - C0
---

# Brainbase Judgment DAG Milestones

This roadmap replaces any implicit assumption that OSS Brainbase stops at memory retrieval. The next milestones make the shared Judgment DAG core real without prematurely building a complete enterprise ontology.

## Program governance

この文書はOSS Judgment DAGのcomponent roadmapであり、cross-repositoryの依存順、開始条件、完了条件は`Unson-LLC/brainbase-unson`の`docs/management/milestones/brainbase-program-master-roadmap.md`に従う。受理した正本snapshotはcommit `18544f58a2a0298d97eab45de2f05544bed48a43`へ固定し、Markdownとmachine-readable JSONのpath・SHA-256は`contracts/judgment-dag/source-lock.json`を正本とする。対応するProgram work packageは R0 / J0 / G0 / R1 / D0 / P0 / C0 である。競合時は固定したProgram Master Roadmapを優先し、この文書のM0〜M6をProgram全体の順序や完了判定へ読み替えない。新しいProgram revisionへ追随する場合は、commitと両content hashを明示的に更新し、契約生成・検証・独立レビューを再実行する。

| Component milestone | Program work package |
|---|---|
| M0 Architecture lock | R0 + J0 |
| M1 Local DAG kernel | J0 |
| M2 Human + Agent judgment runners | G0 |
| M3 Replay and evaluation | R1 |
| M4 Brainbase Deployment dogfood | D0 |
| M5 Scope promotion | P0 |
| M6 Organization-ready primitives | G0 + C0 |

Program statusには `planned` / `contract_ready` / `implementing` / `verified` / `production_proven` / `done` の6語彙だけを使う。hard dependencyを満たさないmilestoneを`done`にしない。文書のmergeだけを実装完了または`done`と扱わず、未実施・未収集・staleな証跡をpassや0件へ丸めない。

## M0 — Architecture lock

Goal: freeze semantic boundaries before implementation.

Exit criteria:
- `judgment-dag-core.md` is accepted.
- Personal and organization scopes share one node/edge model.
- Brainbase/Mana boundary is documented as cognition vs autonomous operation.
- FX/keiba lessons are explicitly adopted: layered ownership, typed boundaries, artifact logs, versioning, evaluation separation.

## M1 — Local DAG kernel

Goal: execute a small deterministic DAG locally.

Deliverables:
- `JudgmentDAGNode` / edge types
- `depends_on` validation
- layer validation
- deterministic runner
- execution artifact store
- execution log
- DAG version identifier

Exit criteria:
- A DAG with Context → Judgment → Resource → Execution → Evaluation runs deterministically.
- Missing dependency and reverse-layer dependency fail before execution.
- Every node output is inspectable after execution.
- Existing Brainbase Graph/Decision storage remains compatible.

## M2 — Human + Agent judgment runners

Goal: allow a judgment node to be performed by a human or an agent without changing DAG semantics.

Deliverables:
- `runner_type = human | agent | deterministic | external`
- pending human-step representation
- agent input/output contract
- explicit authority metadata
- confidence/provenance recording

Exit criteria:
- The same judgment node can be run manually and by an agent.
- Outputs can be compared without hidden context.
- Agent execution cannot silently acquire additional authority.

## M3 — Replay and evaluation

Goal: make judgment quality testable rather than anecdotal.

Deliverables:
- immutable run snapshot / artifact reference
- replay against historical context
- explicit goal/evaluation criteria
- outcome attachment
- pass/fail or scored evaluation
- node-level comparison between versions

Exit criteria:
- A prior DAG version can be replayed against a recorded context.
- A new version can be compared with the prior version without rewriting historical artifacts.
- Evaluation cannot mutate the event set it evaluates.

## M4 — Brainbase Deployment dogfood

Goal: externalize the first real expert judgment process.

Initial flow:

```text
Customer Context
  -> Maturity Judgment
  -> Problem Structure Judgment
  -> Deployment Pattern
  -> Scope / Resource Decision
  -> Proposal / Implementation
  -> Outcome Evaluation
```

Exit criteria:
- At least one real deployment is represented end-to-end.
- Human-only judgment nodes are explicit.
- Each expert escalation is logged as a missing/uncertain DAG capability rather than disappearing into chat.
- KPI: number of decisions requiring the original expert is measurable per deployment.

## M5 — Scope promotion

Goal: prove Personal → Project → Organization judgment promotion using one schema.

Deliverables:
- scope metadata
- promotion candidate workflow
- evidence links
- authority/approval gate
- supersession handling

Exit criteria:
- A personal judgment can become project guidance and then organization policy without schema conversion.
- The historical personal/project records remain queryable.
- Promotion never occurs solely because an LLM repeats the same output.

## M6 — Organization-ready primitives

Goal: keep the core reusable while allowing enterprise products to extend it.

Deliverables in OSS core:
- authority references
- approval hooks
- organization scope primitives
- audit event contract
- connector/runtime adapter interfaces

Not required in OSS M6:
- SSO/SCIM
- enterprise directory sync
- HA hosted runtime
- compliance retention policies
- full multi-user approval UI

Exit criteria:
- `brainbase-unson` can implement enterprise authority/governance without forking the DAG semantic model.

## Product metric hierarchy

The roadmap is not complete merely because graph/node counts increase. Measure:

1. **Replayability** — can Brainbase explain and rerun why a judgment occurred?
2. **Delegatability** — can an agent/another human run the node using explicit contracts?
3. **Expert escalation count** — how often is tacit expert judgment still required?
4. **Outcome calibration** — do judgment versions improve against declared goals?
5. **Promotion quality** — are reusable judgments correctly distinguished from case-specific decisions?

The primary dogfood KPI is **expert escalation count per deployment**, not total stored knowledge.
