---
title: Supersession notice for Brainbase Memory Loop / Mana Operating Loop boundary
status: accepted
date: 2026-08-20
supersedes_in_part: docs/architecture/brainbase-memory-loop-product-boundary.md
superseded_by:
  - docs/architecture/judgment-dag-core.md
---

# Supersession notice

The 2026-08-19 product-boundary decision remains valid for the distinction between Brainbase as a durable state/judgment substrate and Mana as a proactive operating agent, but it is superseded where it states or implies that Brainbase must not own judgment semantics or judgment execution.

Brainbase now owns the shared Judgment DAG model and runtime primitives used by both personal and organizational deployments. This includes typed judgment nodes, dependencies, artifacts, versioning, replay/evaluation, human and agent runners, and scoped promotion from personal to project to organization.

Mana remains the proactive operator that continuously decides when to invoke DAGs, follows through on work, coordinates people, monitors outcomes, and drives operating cadence. Brainbase does not become an always-on autonomous company operator merely because it can represent and execute a judgment DAG.

The authoritative boundary is therefore:

```text
Brainbase = Remember / Model / Resolve / Execute Judgment DAGs / Replay / Learn
Mana      = Operate / Prioritize / Trigger / Coordinate / Follow-through
```

When this notice conflicts with `brainbase-memory-loop-product-boundary.md`, this notice together with `judgment-dag-core.md` is authoritative.
