---
name: vibepro-workflow
description: Use when the user mentions VibePro, Graphify, impact review, diagnose, story selection, graph-sensitive changes, active indicators, realtime sessions, hooks, terminal transport, or workflow gates.
---

# VibePro Workflow

This Skill is only an entrypoint. The source of truth is the Brainbase Capability Map.

## Source Of Truth

- `docs/brainbase-capabilities/capabilities/vibepro.impact-review.yml`
- `docs/brainbase-capabilities/runbooks/vibepro-impact-review.md`
- `docs/brainbase-capabilities/troubleshooting/vibepro-skipped-before-fix.md`

## Steps

1. Open the capability file.
2. Follow the runbook.
3. Use VibePro/Graphify as impact-review evidence, not as source of truth.
4. Verify with code, tests, runtime API, process, or logs.
5. Put `Graphify Impact Review` evidence in the PR body when graph-sensitive files changed.

## Guardrails

- Do not patch graph-sensitive runtime/UI state-machine code before checking Graphify.
- Do not substitute generic VibePro diagnose output for Graphify impact review.
- Do not duplicate the capability record in this Skill.
