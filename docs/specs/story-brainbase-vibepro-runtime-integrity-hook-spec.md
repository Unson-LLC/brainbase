---
spec_id: SPEC-story-brainbase-vibepro-runtime-integrity-hook
title: Brainbase VibePro Runtime Integrity Hook Specification
status: final
date: 2026-08-11
story_id: story-brainbase-vibepro-runtime-integrity-hook
implementation_files:
  - .claude/scripts/hooks/lib/vibepro-runtime-contract.mjs
  - .claude/scripts/hooks/pre-tool-use/git-push-gate.ts
  - .husky/pre-push
test_files:
  - tests/unit/vibepro-runtime-hook-contract.test.js
---

# SPEC: Brainbase VibePro Runtime Integrity Hook

## Invariants

- **INV-1**: Both push hooks delegate runtime validation to one shared validator.
- **INV-2**: The validator invokes only the canonical launcher and pins an exact npm release identity.
- **INV-3**: Missing, dirty, stale, non-npm, invalid-manifest, or mismatched runtime identity blocks the hook.
- **INV-4**: `pr prepare` may influence push judgment only when its runtime identity digest matches the preflight identity digest.

## Contracts

- **C-1**: `identity` outputs exact version, source commit, canonical invocation, and identity digest as JSON.
- **C-2**: `pr-prepare` validates current identity before execution and validates the returned preparation identity after execution.
- **C-3**: `BRAINBASE_ALLOW_PUSH_WITHOUT_GATE=1` skips PR preparation only after canonical runtime validation succeeds.

## Acceptance traceability

- Both hooks use the same validator and canonical launcher (`.claude/scripts/hooks/lib/vibepro-runtime-contract.mjs`).
- Normal hook execution reports the version, source commit, and identity digest; `tests/unit/vibepro-runtime-hook-contract.test.js` verifies those fields.
- 両hookが同じvalidatorとcanonical launcherを使う。
- 通常hook実行時にversion、source commit、identity digestを報告できる。

## Scenarios

- **S-1**: The published `vibepro@0.2.0-beta.5` identity passes and both hooks report the same digest.
- **S-2**: A behind+dirty Git checkout fails because its source kind and integrity contract are not trusted.
- **S-3**: A successful command with a different preparation digest fails closed.
- **S-4**: A missing launcher or malformed JSON fails closed.

## Anti-patterns

- **AP-1**: Invoke `/Users/ksato/workspace/code/vibepro/bin/vibepro.js` or another source checkout.
- **AP-2**: Accept a moving npm dist-tag at hook execution time.
- **AP-3**: Continue on non-zero exit, missing JSON, or parse errors.
