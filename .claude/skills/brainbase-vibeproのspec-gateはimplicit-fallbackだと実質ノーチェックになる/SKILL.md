---
name: brainbase-vibeproのspec-gateはimplicit-fallbackだと実質ノーチェックになる
description: VibeProのSpec gateはimplicit fallbackだと実質ノーチェックになる
---

# brainbase-vibeproのspec-gateはimplicit-fallbackだと実質ノーチェックになる

## Trigger
- Use when this pattern appears: VibeProのSpec gateはimplicit fallbackだと実質ノーチェックになる

## Steps
- 1. Storyごとに docs/specs/<story-id>-spec.md を作る
- 2. Specには Invariants / Contracts / Scenarios / Anti-patterns / Verification を書く
- 3. clause ID（INV-1, S-1, AP-1等）をテスト名に含める
- 4. vibepro pr prepare の gate-dag で spec: implicit や acceptance_criterion: missing がないことを確認する

## Guardrails
- Do not override the linked wiki rule.
- Escalate if the current case contradicts the wiki guidance.

## Linked Wiki
- stories/vibeproのspec-gateはimplicit-fallbackだと実質ノーチェックになる

## Source
- Promoted from explicit_learn / success