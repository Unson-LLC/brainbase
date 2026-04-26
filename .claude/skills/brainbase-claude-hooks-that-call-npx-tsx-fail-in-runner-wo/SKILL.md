---
name: brainbase-claude-hooks-that-call-npx-tsx-fail-in-runner-wo
description: "Claude hooks that call `npx tsx` fail in runner/worktree environments without local Node tooling"
---

# brainbase-claude-hooks-that-call-npx-tsx-fail-in-runner-wo

## Trigger
- Use when this pattern appears: Claude hooks that call `npx tsx` fail in runner/worktree environments without local Node tooling

## Steps
- Failure signature: `sh: tsx: command not found` from `npx tsx .claude/scripts/hooks/...`
- Check affected hook commands in `.claude/settings*.json`.
- Prefer a wrapper such as `.claude/scripts/run-hook.sh <script.ts>` that cd's to the canonical repo root and verifies `node`, package manager, and `tsx` availability before execution.
- For CI/action-runner contexts, install dependencies before Claude starts or avoid TypeScript hook entrypoints there.

## Guardrails
- Do not override the linked wiki rule.
- Escalate if the current case contradicts the wiki guidance.

## Linked Wiki
- architecture/claude-hooks-that-call-npx-tsx-fail-in-runner-wo

## Source
- Promoted from explicit_learn / success